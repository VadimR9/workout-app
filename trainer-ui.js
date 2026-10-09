/* Device-native sharing and local presentation. No social network uploads. */
let attendanceMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function studentWorkoutProgress(student) {
  const workout = student.data?.workoutDraft;
  if (!workout?.startedAt) return null;
  const entries = workout.entries || [];
  return entries.length ? Math.round(entries.filter(entry => entry.done).length / entries.length * 100) : 0;
}

let studentProgressPaintQueued = false;
const studentRingPaint = new WeakMap();

function paintStudentRing(ring, animate = false) {
  const percentage = Number(ring.dataset.progress);
  const previous = studentRingPaint.get(ring);
  if (previous?.target === percentage) return;
  if (previous?.frame) cancelAnimationFrame(previous.frame);
  const state = { value: previous?.value ?? percentage, target: percentage, frame: null };
  studentRingPaint.set(ring, state);
  const draw = value => {
    state.value = value;
    const angle = value / 100 * Math.PI * 2;
    const x = Math.sin(angle);
    const y = -Math.cos(angle);
    ring.style.setProperty('--ring-angle', `${value * 3.6}deg`);
    ring.style.setProperty('--ring-end-x', `calc(${x * 50}% - ${x * 3}px)`);
    ring.style.setProperty('--ring-end-y', `calc(${y * 50}% - ${y * 3}px)`);
    ring.classList.toggle('has-progress', value > 0);
  };
  if (!animate || !previous || matchMedia('(prefers-reduced-motion: reduce)').matches) return draw(percentage);
  const from = state.value;
  const start = performance.now();
  const tick = time => {
    if (!ring.isConnected) return;
    const fraction = Math.min(1, (time - start) / 350);
    draw(from + (percentage - from) * (1 - Math.pow(1 - fraction, 3)));
    if (fraction < 1) state.frame = requestAnimationFrame(tick);
  };
  state.frame = requestAnimationFrame(tick);
}

function renderStudentProgress(percentage) {
  if (percentage === null) return '';
  if (!studentProgressPaintQueued) {
    studentProgressPaintQueued = true;
    queueMicrotask(() => {
      studentProgressPaintQueued = false;
      document.querySelectorAll('.student-progress-ring').forEach(ring => paintStudentRing(ring));
    });
  }
  return `<span class="student-progress-ring" aria-hidden="true" data-progress="${percentage}"><i class="student-ring-track"></i><i class="student-ring-fill"></i><i class="student-ring-cap student-ring-start"></i><i class="student-ring-cap student-ring-end"></i></span>`;
}

function updateStudentProgress() {
  if (!isCoach()) return;
  document.querySelectorAll('[data-student-id]').forEach(button => {
    const student = coachWorkspace.students.find(item => item.id === button.dataset.studentId);
    if (!student) return;
    const percentage = studentWorkoutProgress(student);
    const avatar = button.querySelector('.student-avatar');
    if (!avatar) return;
    const ring = avatar.querySelector('.student-progress-ring');
    const activeDot = avatar.querySelector('.student-active-dot');
    if (percentage === null) activeDot?.remove();
    else if (!activeDot) avatar.insertAdjacentHTML('beforeend', '<i class="student-active-dot" aria-hidden="true"></i>');
    if (percentage === null) ring?.remove();
    else if (!ring) {
      avatar.insertAdjacentHTML('beforeend', renderStudentProgress(percentage));
      paintStudentRing(avatar.querySelector('.student-progress-ring'));
    }
    else {
      ring.dataset.progress = percentage;
      paintStudentRing(ring, true);
    }
    button.setAttribute('aria-label', `${student.name}${percentage === null ? '' : `, занятие идёт, выполнено ${percentage}%`}`);
  });
}

function renderStudentAvatar(student = { name: '', color: 0 }) {
  const avatar = student.avatar || '';
  const photo = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) || /^image\/avatar-(?:anna|mikhail)\.png$/.test(avatar) ? avatar : null;
  const progress = studentWorkoutProgress(student);
  return `<span class="student-avatar avatar-${avatarColor(student)}"><span>${esc(initials(student.name || '?'))}</span>${photo ? `<img src="${esc(photo)}" alt="" decoding="async">` : ''}${renderStudentProgress(progress)}${progress === null ? '' : '<i class="student-active-dot" aria-hidden="true"></i>'}</span>`;
}

function bindStudentAvatarEditor(student) {
  const editor = { value: student?.avatar || '' };
  const fileInput = document.querySelector('#studentAvatarFile');
  const preview = document.querySelector('#studentAvatarPreview');
  const paint = () => preview.innerHTML = renderStudentAvatar({ ...student, name: document.querySelector('#studentName').value || '?', avatar: editor.value });
  document.querySelector('#chooseStudentAvatar').addEventListener('click', () => fileInput.click());
  document.querySelector('#removeStudentAvatar').addEventListener('click', () => { editor.value = ''; paint(); });
  document.querySelector('#studentName').addEventListener('input', paint);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const button = document.querySelector('#saveStudent');
    button.disabled = true;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('Выберите фото размером до 25 МБ');
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('Не удалось открыть фото. Выберите JPEG, PNG или WebP.'));
          image.src = url;
        });
        const size = Math.min(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#26322d'; ctx.fillRect(0, 0, 256, 256);
        ctx.drawImage(img, (img.naturalWidth - size) / 2, (img.naturalHeight - size) / 2, size, size, 0, 0, 256, 256);
        editor.value = canvas.toDataURL('image/jpeg', .85);
        paint();
      } finally { URL.revokeObjectURL(url); }
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; fileInput.value = ''; }
  });
  return editor;
}

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
  const stickyHeight = window.innerWidth < 1100 && isCoach() ? document.querySelector('#coachShell').getBoundingClientRect().height : 12;
  const box = card.getBoundingClientRect();
  const bottom = window.innerHeight - (document.querySelector('.bottom-nav')?.offsetHeight || 80);
  if (box.top < stickyHeight + 12 || box.bottom > bottom) {
    window.scrollTo({ top: Math.max(0, window.scrollY + box.top - stickyHeight - 18), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
}

function renderCoachOverview() {
  if (!currentStudent()) return renderEmpty('Добавьте ученика', 'Откройте список учеников сверху.');
  const monthISO = `${attendanceMonth.getFullYear()}-${String(attendanceMonth.getMonth() + 1).padStart(2, '0')}`;
  return `<div class="coach-summary"><div class="metric-grid"><div class="metric-card"><span>Всего занятий</span><strong>${state.sessions.length}</strong></div><div class="metric-card"><span>В выбранном месяце</span><strong>${state.sessions.filter(session => session.date.startsWith(monthISO)).length}</strong></div></div>${renderAttendanceCalendar()}<section class="section"><h2>Динамика упражнений</h2><button class="secondary-button wide" data-screen-link="progress">Открыть графики</button></section></div>`;
}

function renderAttendanceCalendar() {
  const year = attendanceMonth.getFullYear();
  const month = attendanceMonth.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const title = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(attendanceMonth).replace(' г.', '');
  const cells = Array.from({ length: offset }, () => '<span class="calendar-blank" aria-hidden="true"></span>');
  for (let day = 1; day <= count; day++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const visits = state.sessions.filter(session => session.date === iso);
    cells.push(`<span class="calendar-day ${visits.length ? 'has-visit' : ''} ${iso === localISODate() ? 'is-today' : ''}" aria-label="${formatDate(iso)}, ${visits.length ? `${visits.length} занятий` : 'без занятия'}"><span>${day}</span>${visits.length ? '<i aria-hidden="true"></i>' : ''}</span>`);
  }
  return `<section class="attendance-calendar section"><div class="calendar-heading"><button class="mini-button" data-calendar-month="-1" aria-label="Предыдущий месяц">‹</button><h2>${esc(title)}</h2><button class="mini-button" data-calendar-month="1" aria-label="Следующий месяц">›</button></div><div class="calendar-grid"><div class="calendar-weekdays">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => `<span>${day}</span>`).join('')}</div>${cells.join('')}</div><div class="calendar-legend"><span><i></i> Было занятие</span><button class="text-button" id="calendarToday">Текущий месяц</button></div></section>`;
}

function bindAttendanceCalendar() {
  document.querySelectorAll('[data-calendar-month]').forEach(button => button.addEventListener('click', () => {
    attendanceMonth = new Date(attendanceMonth.getFullYear(), attendanceMonth.getMonth() + Number(button.dataset.calendarMonth), 1);
    render();
  }));
  document.querySelector('#calendarToday')?.addEventListener('click', () => { attendanceMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); render(); });
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

async function workoutShareImage(session, studentName = '') {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  let ctx = canvas.getContext('2d');
  ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const rows = session.entries.map((entry, index) => ({ entry, index, lines: shareTextLines(ctx, exerciseById(entry.exerciseId)?.name || entry.nameSnapshot, 840) }));
  const header = 360 + (studentName ? 60 : 0);
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
  if (studentName) { ctx.fillStyle = '#f4f6ef'; ctx.fillText(studentName, 64, 354); }
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
  const name = isCoach() ? currentStudent()?.name || '' : '';
  let blob;
  let previewUrl;
  let version = 0;
  openModal(`<div class="modal-head"><h2>Тренировка картинкой</h2><button class="close-button" data-close-modal>×</button></div>${name ? '<label class="share-name-option"><input type="checkbox" id="shareStudentName"> Добавить имя ученика</label>' : ''}<div class="workout-share-preview" id="workoutSharePreview"><p class="muted">Готовим изображение…</p></div><div class="share-actions"><button class="primary-button" id="shareWorkoutImage" disabled>Отправить</button><button class="secondary-button" id="downloadWorkoutImage" disabled>Скачать PNG</button></div><p class="muted tiny">«Отправить» откроет меню приложений телефона. Если оно недоступно, картинка скачается.</p>`);
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
      const result = await workoutShareImage(session, document.querySelector('#shareStudentName')?.checked ? name : '');
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
  document.querySelector('#shareStudentName')?.addEventListener('change', build);
  const observer = new MutationObserver(() => {
    if (!preview.isConnected || document.querySelector('#modalBackdrop').classList.contains('hidden')) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      observer.disconnect();
    }
  });
  observer.observe(document.querySelector('#modalBackdrop'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  await build();
}
