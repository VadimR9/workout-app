/* Exercise illustrations only. No workout dates, weights or personal history. */
(function (root) {
  const files = Object.freeze({
    'butterfly-chest': 'Бабочка.png',
    'barbell-curl': 'Бицепс со штангой.png',
    'reverse-dumbbell-lunge': 'Выпад назад с гантелями.png',
    hyperextension: 'Гиперэкстензия.png',
    calf: 'Голень.png',
    'yellow-press-chest': 'Жим в жёлтом тренажёре — грудь.png',
    'yellow-press-shoulders': 'Жим вертикальный в жёлтом тренажёре — плечи.png',
    'seated-leg-press': 'Жим ногами сидя в тренажере.png',
    'lateral-raise-blue': 'Махи в стороны в синем кроссовере на плечи.png',
    'rear-pec-deck': 'Пек-дек задняя.png',
    'ball-abs': 'Пресс на мяче.png',
    'barbell-upright-row': 'Протяжка со штангой.png',
    'hip-abduction': 'Разведение ног в тренажёре.png',
    'leg-extension': 'Разгибание ног в тренажёре.png',
    'seated-leg-curl': 'Сгибание ног сидя в тренажёре.png',
    'triceps-machine': 'Трицепс в тренажёре.png',
    'vertical-pull-blue-reverse': 'Тяга вертикальная в синем тренажёре обратным хватом.png',
    'horizontal-row-brown': 'Тяга горизонтальная в коричневом тренажёре.png',
    shrugs: 'Шраги.png'
  });
  const source = (id) => files[id] ? `./image/${encodeURIComponent(files[id])}` : null;
  const api = Object.freeze({ files, source, assets: Object.values(files).map((file) => `./image/${encodeURIComponent(file)}`) });
  root.ExerciseMedia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
