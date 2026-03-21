const { runResearch, runVideoGeneration } = require('../services/tutorial');
const Project = require('../models/Project');
const jwt = require('jsonwebtoken');

module.exports = function (io) {
  // Auth middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (user: ${socket.userId})`);

    // ─────────────────────────────────────────────
    // PHASE 1: Research — topic → steps + images
    // Client sends: { projectId }
    // Server emits events as pipeline progresses
    // ─────────────────────────────────────────────
    socket.on('tutorial:research', async (data) => {
      const { projectId } = data;

      try {
        const project = await Project.findOne({ _id: projectId, user: socket.userId });
        if (!project) {
          return socket.emit('error', { message: 'Project not found' });
        }

        project.status = 'generating';
        await project.save();

        const emit = (event, payload) => {
          socket.emit(event, payload);
        };

        const result = await runResearch(project.topic, emit);

        // Save research results
        project.sessionId = result.sessionId;
        project.tutorial = result.tutorial;
        project.stats = { phase1Time: result.stats.phase1Time };

        socket.emit('tutorial:ready', {
          projectId: project._id,
          sessionId: project.sessionId,
          tutorial: project.tutorial,
          stats: project.stats,
        });

        // Auto-trigger video generation — skip manual review
        project.status = 'video_generating';
        await project.save();

        const videoResult = await runVideoGeneration(
          project.sessionId,
          project.tutorial.steps,
          project.tutorial,
          emit
        );

        // Update project with video info
        project.tutorial.steps = videoResult.steps;
        project.status = 'complete';
        project.stats.phase2Time = videoResult.time;
        project.stats.totalTime = (project.stats.phase1Time || 0) + videoResult.time;
        await project.save();

        socket.emit('tutorial:complete', {
          projectId: project._id,
          sessionId: project.sessionId,
          tutorial: project.tutorial,
          stats: project.stats,
          finalVideo: 'final-video.mp4',
        });

      } catch (err) {
        console.error('Research error:', err.message);
        await Project.findByIdAndUpdate(projectId, { status: 'error', error: err.message });
        socket.emit('error', { message: err.message });
      }
    });

    // ─────────────────────────────────────────────
    // PHASE 2: Generate videos from (edited) steps
    // Client sends: { projectId, steps? }
    // steps is optional — if provided, uses edited steps
    // ─────────────────────────────────────────────
    socket.on('tutorial:generate-videos', async (data) => {
      const { projectId, steps } = data;

      try {
        const project = await Project.findOne({ _id: projectId, user: socket.userId });
        if (!project) {
          return socket.emit('error', { message: 'Project not found' });
        }
        if (!project.sessionId) {
          return socket.emit('error', { message: 'Run research first' });
        }

        // Use edited steps if provided, otherwise use existing
        const stepsToUse = steps || project.tutorial.steps;

        project.status = 'video_generating';
        if (steps) project.tutorial.steps = steps;
        await project.save();

        const emit = (event, payload) => {
          socket.emit(event, payload);
        };

        const result = await runVideoGeneration(project.sessionId, stepsToUse, project.tutorial, emit);

        // Update project with video info
        project.tutorial.steps = result.steps;
        project.status = 'complete';
        project.stats.phase2Time = result.time;
        project.stats.totalTime = (project.stats.phase1Time || 0) + result.time;
        await project.save();

        socket.emit('tutorial:complete', {
          projectId: project._id,
          sessionId: project.sessionId,
          tutorial: project.tutorial,
          stats: project.stats,
          finalVideo: 'final-video.mp4',
        });

      } catch (err) {
        console.error('Video generation error:', err.message);
        await Project.findByIdAndUpdate(projectId, { status: 'error', error: err.message });
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
};
