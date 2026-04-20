const supabase = require('../config/supabase');

function generateSlug(topic, id) {
  const base = (topic || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70);
  const prefix = base.startsWith('how-to') ? '' : 'video-tutorial-';
  const suffix = id ? String(id).slice(-6) : Date.now().toString(36).slice(-6);
  return prefix + base + '-' + suffix;
}

function shapeProject(row) {
  if (!row) return row;
  const steps = (row.project_steps || [])
    .slice()
    .sort((a, b) => (a.step || 0) - (b.step || 0))
    .map(shapeStep);
  const { project_steps, ...rest } = row;
  return {
    ...rest,
    _id: row.id,
    isPublic: row.is_public,
    createdAt: row.created_at,
    sessionId: row.session_id,
    tutorial: {
      title: row.tutorial_title,
      url: row.tutorial_url,
      source: row.tutorial_source,
      wikiUrl: row.tutorial_wiki_url,
      steps,
    },
  };
}

function shapeStep(row) {
  if (!row) return row;
  return {
    id: row.id,
    step: row.step,
    title: row.title,
    description: row.description,
    screenshot: row.screenshot,
    imageUrl: row.image_url,
    video: row.video,
    videoSize: row.video_size,
    candidates: row.candidates || [],
    validCandidates: row.valid_candidates || [],
    picked: row.picked,
    annotated: row.annotated,
    highlightLabel: row.highlight_label,
  };
}

function stepToRow(projectId, step) {
  return {
    project_id: projectId,
    step: step.step,
    title: step.title || null,
    description: step.description || null,
    screenshot: step.screenshot || null,
    image_url: step.imageUrl || null,
    video: step.video || null,
    video_size: step.videoSize || null,
    candidates: step.candidates || null,
    valid_candidates: step.validCandidates || null,
    picked: typeof step.picked === 'number' ? step.picked : null,
    annotated: typeof step.annotated === 'boolean' ? step.annotated : null,
    highlight_label: step.highlightLabel || null,
  };
}

async function loadWithSteps(filter) {
  let query = supabase
    .from('projects')
    .select('*, project_steps(*), users:user_id (id, name, picture)')
    .limit(1);

  for (const [k, v] of Object.entries(filter)) query = query.eq(k, v);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const shaped = shapeProject(data);
  shaped.user = data.users ? { _id: data.users.id, name: data.users.name, picture: data.users.picture } : null;
  return shaped;
}

async function findById(id) {
  return loadWithSteps({ id });
}

async function findByIdForUser(id, userId) {
  return loadWithSteps({ id, user_id: userId });
}

async function findBySlug(slug) {
  return loadWithSteps({ slug });
}

async function listForUser(userId) {
  const { data, error } = await supabase
    .from('projects')
    .select('*, project_steps(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(shapeProject);
}

async function create({ user, topic, source, status }) {
  const insertPayload = {
    user_id: user,
    topic,
    source: source || 'auto',
    status: status || 'draft',
  };
  const { data, error } = await supabase
    .from('projects')
    .insert(insertPayload)
    .select()
    .single();
  if (error) throw error;

  const slug = generateSlug(topic, data.id);
  const { data: withSlug, error: slugErr } = await supabase
    .from('projects')
    .update({ slug })
    .eq('id', data.id)
    .select()
    .single();
  if (slugErr) throw slugErr;

  return shapeProject({ ...withSlug, project_steps: [] });
}

async function updateProject(id, patch) {
  const row = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.sessionId !== undefined) row.session_id = patch.sessionId;
  if (patch.stats !== undefined) row.stats = patch.stats;
  if (patch.isPublic !== undefined) row.is_public = patch.isPublic;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.tags !== undefined) row.tags = patch.tags;
  if (patch.views !== undefined) row.views = patch.views;
  if (patch.likes !== undefined) row.likes = patch.likes;
  if (patch.tutorial) {
    if (patch.tutorial.title !== undefined) row.tutorial_title = patch.tutorial.title;
    if (patch.tutorial.url !== undefined) row.tutorial_url = patch.tutorial.url;
    if (patch.tutorial.source !== undefined) row.tutorial_source = patch.tutorial.source;
    if (patch.tutorial.wikiUrl !== undefined) row.tutorial_wiki_url = patch.tutorial.wikiUrl;
  }

  if (Object.keys(row).length > 0) {
    const { error } = await supabase.from('projects').update(row).eq('id', id);
    if (error) throw error;
  }

  if (patch.tutorial?.steps) {
    await replaceSteps(id, patch.tutorial.steps);
  }

  return findById(id);
}

async function replaceSteps(projectId, steps) {
  const { error: delErr } = await supabase
    .from('project_steps')
    .delete()
    .eq('project_id', projectId);
  if (delErr) throw delErr;

  if (!steps?.length) return;

  const rows = steps.map((s, i) => stepToRow(projectId, { ...s, step: s.step ?? i + 1 }));
  const { error } = await supabase.from('project_steps').insert(rows);
  if (error) throw error;
}

async function updateStep(projectId, stepIndex, patch) {
  const { data: steps, error } = await supabase
    .from('project_steps')
    .select('*')
    .eq('project_id', projectId)
    .order('step');
  if (error) throw error;
  const target = steps[stepIndex];
  if (!target) return null;

  const row = stepToRow(projectId, { ...shapeStep(target), ...patch });
  const { error: upErr } = await supabase
    .from('project_steps')
    .update(row)
    .eq('id', target.id);
  if (upErr) throw upErr;
  return findById(projectId);
}

async function deleteProject(id, userId) {
  const { data, error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function incrementViews(slug) {
  const { data: current, error: fErr } = await supabase
    .from('projects')
    .select('id, views, is_public, status')
    .eq('slug', slug)
    .eq('is_public', true)
    .eq('status', 'complete')
    .maybeSingle();
  if (fErr) throw fErr;
  if (!current) return null;
  const { data: updated, error } = await supabase
    .from('projects')
    .update({ views: (current.views || 0) + 1 })
    .eq('id', current.id)
    .select()
    .single();
  if (error) throw error;
  return updated.id;
}

async function incrementLikes(slug) {
  const { data: current, error: fErr } = await supabase
    .from('projects')
    .select('id, likes')
    .eq('slug', slug)
    .eq('is_public', true)
    .maybeSingle();
  if (fErr) throw fErr;
  if (!current) return null;
  const { data: updated, error } = await supabase
    .from('projects')
    .update({ likes: (current.likes || 0) + 1 })
    .eq('id', current.id)
    .select('likes')
    .single();
  if (error) throw error;
  return updated.likes;
}

async function findCompletedByNormalizedTopic(normalizedTopic) {
  const { data, error } = await supabase
    .from('projects')
    .select('*, project_steps(*)')
    .eq('status', 'complete')
    .not('session_id', 'is', null)
    .limit(200);
  if (error) throw error;
  const normalize = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
  const match = (data || []).find((p) => normalize(p.topic) === normalizedTopic);
  return match ? shapeProject(match) : null;
}

async function listPublic({ category, search, sort, page, limit }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('projects')
    .select('*, project_steps(*), users:user_id (id, name, picture)', { count: 'exact' })
    .eq('is_public', true)
    .eq('status', 'complete');

  if (category && category !== 'all') query = query.eq('category', category);
  if (search) {
    const safe = String(search).replace(/[%_]/g, (m) => '\\' + m);
    query = query.or(`topic.ilike.%${safe}%,tutorial_title.ilike.%${safe}%,tags.cs.{${safe}}`);
  }

  if (sort === 'popular') query = query.order('views', { ascending: false });
  else if (sort === 'likes') query = query.order('likes', { ascending: false });
  else query = query.order('created_at', { ascending: false });

  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  const items = (data || []).map((row) => {
    const shaped = shapeProject(row);
    shaped.user = row.users ? { _id: row.users.id, name: row.users.name, picture: row.users.picture } : null;
    return shaped;
  });
  return { items, total: count || 0 };
}

module.exports = {
  findById,
  findByIdForUser,
  findBySlug,
  listForUser,
  create,
  updateProject,
  replaceSteps,
  updateStep,
  deleteProject,
  incrementViews,
  incrementLikes,
  findCompletedByNormalizedTopic,
  listPublic,
  shapeProject,
  generateSlug,
};
