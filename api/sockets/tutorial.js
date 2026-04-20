const { runResearch, runVideoGeneration } = require('../services/tutorial');
const projects = require('../db/projects');
const supabase = require('../config/supabase');

module.exports = function (io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return next(new Error('Invalid token'));
      socket.userId = data.user.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (user: ${socket.userId})`);

    // ─────────────────────────────────────────────
    // PHASE 1: Research — topic → steps + images
    // ─────────────────────────────────────────────
    socket.on('tutorial:research', async (data) => {
      const { projectId } = data;

      try {
        const project = await projects.findByIdForUser(projectId, socket.userId);
        if (!project) {
          return socket.emit('error', { message: 'Project not found' });
        }

        await projects.updateProject(project.id, { status: 'generating' });

        const emit = (event, payload) => {
          socket.emit(event, payload);
        };

        const result = await runResearch(project.topic, emit, project.source || null);

        const phase1Stats = { phase1Time: result.stats.phase1Time };
        const updated = await projects.updateProject(project.id, {
          sessionId: result.sessionId,
          stats: phase1Stats,
          tutorial: {
            title: result.tutorial.title,
            url: result.tutorial.url,
            source: result.tutorial.source,
            wikiUrl: result.tutorial.wikiUrl,
            steps: result.tutorial.steps,
          },
        });

        socket.emit('tutorial:ready', {
          projectId: updated.id,
          sessionId: updated.session_id,
          tutorial: updated.tutorial,
          stats: updated.stats,
        });

        await projects.updateProject(project.id, { status: 'video_generating' });

        const videoResult = await runVideoGeneration(
          updated.session_id,
          updated.tutorial.steps,
          updated.tutorial,
          emit
        );

        const totalStats = {
          phase1Time: phase1Stats.phase1Time,
          phase2Time: videoResult.time,
          totalTime: (phase1Stats.phase1Time || 0) + videoResult.time,
        };

        const finalProject = await projects.updateProject(project.id, {
          status: 'complete',
          stats: totalStats,
          tutorial: { steps: videoResult.steps },
        });

        socket.emit('tutorial:complete', {
          projectId: finalProject.id,
          sessionId: finalProject.session_id,
          tutorial: finalProject.tutorial,
          stats: finalProject.stats,
          finalVideo: 'final-video.mp4',
        });

      } catch (err) {
        console.error('Research error:', err.message);
        try {
          await projects.updateProject(projectId, { status: 'error', error: err.message });
        } catch {}
        socket.emit('error', { message: err.message });
      }
    });

    // ─────────────────────────────────────────────
    // PHASE 2: Generate videos from (edited) steps
    // ─────────────────────────────────────────────
    socket.on('tutorial:generate-videos', async (data) => {
      const { projectId, steps } = data;

      try {
        const project = await projects.findByIdForUser(projectId, socket.userId);
        if (!project) {
          return socket.emit('error', { message: 'Project not found' });
        }
        if (!project.session_id) {
          return socket.emit('error', { message: 'Run research first' });
        }

        const stepsToUse = steps || project.tutorial.steps;

        const patch = { status: 'video_generating' };
        if (steps) patch.tutorial = { steps };
        const projectInGen = await projects.updateProject(project.id, patch);

        const emit = (event, payload) => {
          socket.emit(event, payload);
        };

        const result = await runVideoGeneration(projectInGen.session_id, stepsToUse, projectInGen.tutorial, emit);

        const totalStats = {
          phase1Time: projectInGen.stats?.phase1Time || 0,
          phase2Time: result.time,
          totalTime: (projectInGen.stats?.phase1Time || 0) + result.time,
        };

        const finalProject = await projects.updateProject(project.id, {
          status: 'complete',
          stats: totalStats,
          tutorial: { steps: result.steps },
        });

        socket.emit('tutorial:complete', {
          projectId: finalProject.id,
          sessionId: finalProject.session_id,
          tutorial: finalProject.tutorial,
          stats: finalProject.stats,
          finalVideo: 'final-video.mp4',
        });

      } catch (err) {
        console.error('Video generation error:', err.message);
        try {
          await projects.updateProject(projectId, { status: 'error', error: err.message });
        } catch {}
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
};
