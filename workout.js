/* Local workout drafts and automatic saving. */
let workoutSaveFailed = false;
let restoringWorkoutPosition = false;

function rememberWorkoutPosition() {
  if (!draftSession || currentScreen !== 'start' || document.querySelector('[data-workout-session]')?.dataset.sessionId !== draftSession.id || restoringWorkoutPosition) return;
  draftSession.scrollY = window.scrollY;
  persistWorkout();
}

function persistWorkout() {
  if (!draftSession) return true;
  if (draftSession.isNew) state.workoutDraft = JSON.parse(JSON.stringify(draftSession));
  else {
    const index = state.sessions.findIndex(session => session.id === draftSession.id);
    if (index >= 0) {
      const clean = { ...draftSession };
      delete clean.isNew;
      state.sessions[index] = clean;
    }
  }
  const saved = saveState();
  return saved;
}

function updateWorkoutStatus() {
  const status = document.querySelector('#workoutSaveStatus');
  if (status) {
    status.textContent = workoutSaveFailed ? 'Не удалось сохранить. Скачайте резервную копию.' : '';
    status.hidden = !workoutSaveFailed;
    status.classList.toggle('save-error', workoutSaveFailed);
  }
}

function beginDraft(templateId) {
  if (state.workoutDraft) {
    draftSession = JSON.parse(JSON.stringify(state.workoutDraft));
    showToast('Возвращаемся к сохранённому занятию');
  } else {
    draftSession = makeDraft(templateId);
    persistWorkout();
  }
  setScreen('start', { keepDraft: true, restoreWorkout: true });
}

function startWorkout() {
  if (!draftSession?.isNew || draftSession.startedAt) return;
  syncDraftFromForm();
  draftSession.startedAt = new Date().toISOString();
  if (!persistWorkout()) return;
  const top = window.scrollY;
  render();
  window.scrollTo({ top, behavior: 'instant' });
}

function updateWorkoutMarkers() {
  if (!draftSession) return;
  document.querySelectorAll('.entry-card[data-entry-index]').forEach(card => {
    const entry = draftSession.entries[Number(card.dataset.entryIndex)];
    const last = entry.entryId === draftSession.lastEntryId;
    card.classList.toggle('entry-last-edited', last);
    card.classList.toggle('entry-done', !!entry.done);
    card.querySelector('.entry-position-label').textContent = last ? 'Остановились здесь' : '';
    const button = card.querySelector('[data-entry-done]');
    if (button) {
      button.setAttribute('aria-pressed', String(!!entry.done));
      button.innerHTML = `<span aria-hidden="true">${entry.done ? '✓' : '○'}</span> ${entry.done ? 'Выполнено' : 'Готово'}`;
    }
  });
  updateHeaderProgress();
}

async function discardWorkout() {
  if (!draftSession) return;
  if (!await confirmAction('Черновик и введённые результаты этого занятия будут удалены. Завершённые тренировки останутся.', draftSession.startedAt ? 'Отменить занятие?' : 'Убрать черновик?', 'Удалить черновик')) return;
  delete state.workoutDraft;
  draftSession = null;
  saveState();
  setScreen('home', { restoreWorkout: true });
}

function chooseWorkoutProgramme() {
  syncDraftFromForm();
  openModal(`<div class="modal-head"><h2>Выбрать тренировку</h2><button class="close-button" data-close-modal>×</button></div><p class="muted tiny">${state.templates.map(template => esc(template.name)).join(' → ')} → сначала. Дни недели задавать не нужно.</p><div class="template-list">${state.templates.map(template => `<button class="template-card ${draftSession?.templateId === template.id ? 'programme-selected' : ''}" data-replace-programme="${esc(template.id)}"><span><strong>${esc(template.name)}</strong><small class="programme-option-meta">${template.exerciseIds.length} упражнений${template.id === nextTemplateId() ? ' · следующая по порядку' : ''}</small></span><span class="chevron">${draftSession?.templateId === template.id ? '✓' : '›'}</span></button>`).join('')}<button class="template-card" data-replace-programme="">Свободное занятие</button></div>`);
  document.querySelectorAll('[data-replace-programme]').forEach(button => button.addEventListener('click', () => useWorkoutProgramme(button.dataset.replaceProgramme)));
}

async function useWorkoutProgramme(templateId) {
    syncDraftFromForm();
    if (!draftSession?.isNew) draftSession = state.workoutDraft ? structuredClone(state.workoutDraft) : makeDraft(templateId);
    if (draftSession.templateId === (templateId || null)) { closeModal(); setScreen('start'); return; }
    if ((draftSession.startedAt || draftSession.hasEdits) && draftSession.templateId !== templateId && !await confirmAction('Упражнения, которых нет в выбранной программе, будут убраны из этого занятия. Значения остальных сохранятся.', 'Сменить программу?', 'Сменить')) return;
    const replacement = makeDraft(templateId);
    replacement.entries = replacement.entries.map(entry => draftSession.entries.find(old => old.exerciseId === entry.exerciseId) || entry);
    draftSession = { ...draftSession, templateId: replacement.templateId, templateName: replacement.templateName, programmeName: replacement.programmeName, programmeFingerprint: replacement.programmeFingerprint, entries: replacement.entries, scrollY: 0 };
    persistWorkout();
    closeModal();
    setScreen('start');
    window.scrollTo({ top: 0, behavior: 'instant' });
}

function nextTemplateId() {
  const last = sortedSessions().find(session => state.templates.some(template => template.id === session.templateId));
  const index = last ? state.templates.findIndex(template => template.id === last.templateId) : -1;
  return state.templates.length ? state.templates[(index + 1) % state.templates.length].id : '';
}

function navigateScreen(screen) {
  if (screen === 'start' && !draftSession?.isNew) draftSession = state.workoutDraft ? structuredClone(state.workoutDraft) : null;
  setScreen(screen);
}

function refreshPreparedProgramme() {
  if (!draftSession?.isNew || draftSession.startedAt || !draftSession.programmeFingerprint) return;
  const template = templateById(draftSession.templateId);
  if (!template) return;
  const fingerprint = JSON.stringify([template.name, template.exerciseIds]);
  if (fingerprint === draftSession.programmeFingerprint) return;
  const updated = makeDraft(template.id);
  draftSession.entries = updated.entries.map(entry => draftSession.entries.find(old => old.exerciseId === entry.exerciseId) || entry);
  if (draftSession.templateName === draftSession.programmeName) draftSession.templateName = template.name;
  draftSession.programmeName = template.name;
  draftSession.programmeFingerprint = fingerprint;
  persistWorkout();
}

function restoreWorkoutPosition() {
  if (currentScreen !== 'start' || !draftSession) return;
  const sessionId = draftSession.id;
  const top = draftSession.scrollY || 0;
  restoringWorkoutPosition = true;
  const restore = () => {
    if (currentScreen === 'start' && draftSession?.id === sessionId) window.scrollTo({ top, behavior: 'instant' });
  };
  requestAnimationFrame(() => requestAnimationFrame(restore));
  setTimeout(() => { restore(); restoringWorkoutPosition = false; }, 140);
}


/* Workout progress and device-native image sharing. */
function updateHeaderProgress() {
  let progress = document.querySelector('#headerWorkoutProgress');
  if (!progress) {
    progress = document.createElement('div');
    progress.id = 'headerWorkoutProgress';
    progress.innerHTML = '<i></i><span class="progress-milestones" aria-hidden="true"></span>';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Выполнение упражнений');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    document.querySelector('.topbar').appendChild(progress);
  }
  progress.hidden = currentScreen !== 'start' || !draftSession || !draftSession.entries.length || (draftSession.isNew && !draftSession.startedAt);
  const count = draftSession?.entries.length || 0;
  const percentage = count ? Math.round(draftSession.entries.filter(entry => entry.done).length / count * 100) : 0;
  progress.style.setProperty('--workout-progress', `${percentage}%`);
  progress.style.setProperty('--workout-steps', Math.max(1, count));
  progress.dataset.empty = String(percentage === 0);
  progress.dataset.complete = String(percentage === 100);
  progress.setAttribute('aria-valuenow', String(percentage));
}

function revealExercise(entryId) {
  const card = [...document.querySelectorAll('[data-entry-id]')].find(element => element.dataset.entryId === entryId);
  if (!card) return;
  const stickyHeight = 12;
  const box = card.getBoundingClientRect();
  const bottom = window.innerHeight - (document.querySelector('.bottom-nav')?.offsetHeight || 80);
  if (box.top < stickyHeight + 12 || box.bottom > bottom) {
    window.scrollTo({ top: Math.max(0, window.scrollY + box.top - stickyHeight - 18), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
}

function shareTextLines(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > width) { lines.push(line); line = word; }
    else line = candidate;
  }
  lines.push(line);
  return lines;
}

async function workoutShareImage(session) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  let ctx = canvas.getContext('2d');
  ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const rows = session.entries.map((entry, index) => ({ entry, index, lines: shareTextLines(ctx, exerciseById(entry.exerciseId)?.name || entry.nameSnapshot, 840) }));
  const header = 360;
  canvas.height = header + rows.reduce((sum, row) => sum + row.lines.length * 42 + 94, 0) + 100;
  ctx = canvas.getContext('2d');
  ctx.fillStyle = '#10141a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#c8ff47'; ctx.fillRect(64, 64, 68, 6);
  ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(session.isNew ? session.startedAt ? 'ЗАНЯТИЕ В ПРОЦЕССЕ' : 'ПЛАН ТРЕНИРОВКИ' : 'ТРЕНИРОВКА', 64, 115);
  ctx.fillStyle = '#f4f6ef';
  ctx.font = '700 48px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const title = shareTextLines(ctx, session.templateName, 940);
  title.slice(0, 2).forEach((line, index) => ctx.fillText(line, 64, 182 + index * 58));
  ctx.font = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#a3adba'; ctx.fillText(formatDate(session.date, { year: 'numeric' }), 64, 300);
  let y = header;
  rows.forEach(({ entry, index, lines }) => {
    ctx.strokeStyle = '#2a313b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(64, y); ctx.lineTo(1016, y); ctx.stroke();
    ctx.fillStyle = '#7f8b9b'; ctx.font = '24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(String(index + 1).padStart(2, '0'), 64, y + 49);
    ctx.fillStyle = '#f4f6ef'; ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    lines.forEach((line, i) => ctx.fillText(line, 144, y + 49 + i * 42));
    ctx.fillStyle = entry.done ? '#c8ff47' : '#a3adba'; ctx.font = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const result = Number(entry.weight) > 0 ? `${fmtNumber(entry.weight)} кг × ${fmtNumber(entry.reps)} повт.` : `${fmtNumber(entry.reps)} повт.`;
    ctx.fillText(`${result}${entry.done ? '   ✓' : ''}`, 144, y + lines.length * 42 + 58);
    y += lines.length * 42 + 94;
  });
  ctx.fillStyle = '#7f8b9b'; ctx.font = '22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('Тренировочный дневник', 64, canvas.height - 40);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось создать изображение')), 'image/png'));
}

async function openWorkoutShare() {
  syncDraftFromForm();
  const session = structuredClone(draftSession);
  if (!session?.entries.length) return showToast('Добавьте упражнения, чтобы поделиться тренировкой');
  let blob;
  let previewUrl;
  let version = 0;
  openModal(`<div class="modal-head"><h2>Тренировка картинкой</h2><button class="close-button" data-close-modal>×</button></div><div class="workout-share-preview" id="workoutSharePreview"><p class="muted">Готовим изображение…</p></div><div class="share-actions"><button class="primary-button" id="shareWorkoutImage" disabled>Отправить</button><button class="secondary-button" id="downloadWorkoutImage" disabled>Скачать PNG</button></div><p class="muted tiny">«Отправить» откроет меню приложений телефона. Если оно недоступно, картинка скачается.</p>`);
  const preview = document.querySelector('#workoutSharePreview');
  const shareButton = document.querySelector('#shareWorkoutImage');
  const downloadButton = document.querySelector('#downloadWorkoutImage');
  const filename = `workout-${session.date}.png`;
  const download = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const build = async () => {
    const currentVersion = ++version;
    shareButton.disabled = downloadButton.disabled = true;
    try {
      const result = await workoutShareImage(session);
      if (currentVersion !== version || !preview.isConnected || document.querySelector('#modalBackdrop').classList.contains('hidden')) return;
      blob = result;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      preview.innerHTML = `<img src="${previewUrl}" alt="Картинка тренировки для отправки">`;
      shareButton.disabled = downloadButton.disabled = false;
    } catch (error) { if (preview.isConnected) preview.textContent = error.message; }
  };
  shareButton.addEventListener('click', async () => {
    if (!blob) return;
    const file = new File([blob], filename, { type: 'image/png' });
    if (!navigator.canShare?.({ files: [file] })) return download();
    try { await navigator.share({ files: [file], title: session.templateName }); }
    catch (error) { if (error.name !== 'AbortError') { download(); showToast('Картинка скачана — её можно отправить вручную'); } }
  });
  downloadButton.addEventListener('click', download);
  const observer = new MutationObserver(() => {
    if (!preview.isConnected || document.querySelector('#modalBackdrop').classList.contains('hidden')) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      observer.disconnect();
    }
  });
  observer.observe(document.querySelector('#modalBackdrop'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  await build();
}
