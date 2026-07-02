import { DEFAULT_CATEGORIES } from './constants';

type SeedOption = { id: string; text: string; imageUrl?: string };
export type SeedQuestion = {
  category: string;
  phase: string;
  question_text: string;
  options: SeedOption[];
  correct_option_id: string;
  explanation: string;
  points: number;
  is_active: boolean;
};

type OptionId = 'A' | 'B' | 'C' | 'D';

function optionSet(correct: number | string, distractors: Array<number | string>, correctId: OptionId = 'B') {
  const ids: OptionId[] = ['A', 'B', 'C', 'D'];
  const values: Record<string, string> = {};
  const distractorValues = distractors.map(String).filter(value => value !== String(correct));
  let d = 0;
  for (const id of ids) {
    values[id] = id === correctId ? String(correct) : String(distractorValues[d++] ?? Number(correct) + d + 1);
  }
  return ids.map(id => ({ id, text: values[id] }));
}

function addQuestion(rows: SeedQuestion[], category: string, phase: string, topic: string, text: string, correct: number | string, distractors: Array<number | string>, correctId: OptionId = 'B') {
  rows.push({
    category,
    phase,
    // Do not show the question type/topic to candidates.
    question_text: text,
    options: optionSet(correct, distractors, correctId),
    correct_option_id: correctId,
    explanation: `Seeded Mezzopedia ${topic} question. Correct answer: ${correct}.`,
    points: 1,
    is_active: true
  });
}

function levelFor(category: string) {
  const index = DEFAULT_CATEGORIES.indexOf(category);
  return Math.max(1, index + 1);
}

function correctIdFor(index: number): OptionId {
  return (['A', 'B', 'C', 'D'] as OptionId[])[index % 4];
}

export function buildSeedQuestionsForCategory(category: string, phase = 'Stage 1'): SeedQuestion[] {
  const rows: SeedQuestion[] = [];
  const level = levelFor(category);
  const a = 3 + level;
  const b = 8 + level * 2;
  const c = 12 + level * 3;
  const d = 5 + level;

  // Twenty Algebra questions
  addQuestion(rows, category, phase, 'Algebra', `Solve for x: x + ${a} = ${c}.`, c - a, [c - a - 2, c - a + 2, c + a], 'B');
  addQuestion(rows, category, phase, 'Algebra', `Solve for y: ${d}y = ${d * (level + 3)}.`, level + 3, [level + 1, level + 4, d + level], 'C');
  addQuestion(rows, category, phase, 'Algebra', `Simplify: ${level + 2}m + ${level + 5}m - ${level}m.`, `${level + 7}m`, [`${level + 5}m`, `${level + 6}m`, `${level + 8}m`], 'A');
  addQuestion(rows, category, phase, 'Algebra', `If p = ${level + 4}, find 2p² - ${level}.`, 2 * Math.pow(level + 4, 2) - level, [2 * (level + 4) - level, Math.pow(level + 4, 2), 2 * Math.pow(level + 4, 2)], 'D');
  addQuestion(rows, category, phase, 'Algebra', `Solve: z/2 + ${level + 1} = ${level + 9}.`, 2 * ((level + 9) - (level + 1)), [((level + 9) - (level + 1)), 2 * (level + 9), 2 * ((level + 9) - (level + 1)) + 2], 'B');

  for (let i = 1; i <= 5; i++) {
    const coeff = level + i + 2;
    const rhs = coeff * (level + i + 4);
    const constant = i + level;
    const correct = (rhs - constant) / coeff;
    addQuestion(rows, category, phase, 'Algebra', `Solve for x: ${coeff}x + ${constant} = ${rhs}.`, correct, [correct - 1, correct + 1, correct + 2], correctIdFor(i));
  }

  for (let i = 1; i <= 5; i++) {
    const xCoeff = level + i + 1;
    const yCoeff = i + 2;
    const x = level + i;
    const y = level + 2;
    const correct = xCoeff * x + yCoeff * y;
    addQuestion(rows, category, phase, 'Algebra', `If x = ${x} and y = ${y}, find ${xCoeff}x + ${yCoeff}y.`, correct, [correct - xCoeff, correct - yCoeff, correct + yCoeff], correctIdFor(i + 5));
  }

  for (let i = 1; i <= 5; i++) {
    const left = level + i + 3;
    const right = level + i + 6;
    const minus = i + 1;
    const correct = left + right - minus;
    addQuestion(rows, category, phase, 'Algebra', `Simplify: ${left}a + ${right}a - ${minus}a.`, `${correct}a`, [`${correct - 1}a`, `${correct + 1}a`, `${left + right}a`], correctIdFor(i + 10));
  }

  // Ten Aptitude questions
  const patternStart = level + 2;
  addQuestion(rows, category, phase, 'Aptitude', `Find the next number: ${patternStart}, ${patternStart + 3}, ${patternStart + 6}, ${patternStart + 9}, __.`, patternStart + 12, [patternStart + 10, patternStart + 11, patternStart + 15], 'B');
  addQuestion(rows, category, phase, 'Aptitude', `If ${level + 2} pens cost GHS ${(level + 2) * 3}, how much will ${level + 5} pens cost at the same rate?`, (level + 5) * 3, [(level + 4) * 3, (level + 5) * 2, (level + 5) * 4], 'C');
  addQuestion(rows, category, phase, 'Aptitude', `A contest code has ${level + 3} digits. How many digits are in ${level + 4} such codes?`, (level + 3) * (level + 4), [(level + 3) + (level + 4), (level + 3) * (level + 3), (level + 4) * (level + 4)], 'A');

  for (let i = 1; i <= 7; i++) {
    const first = level + i;
    const step = i + 2;
    const correct = first + step * 4;
    addQuestion(rows, category, phase, 'Aptitude', `Complete the pattern: ${first}, ${first + step}, ${first + step * 2}, ${first + step * 3}, __.`, correct, [correct - 1, correct + 1, correct + step], correctIdFor(i + 14));
  }

  // Ten Statistics questions
  const values = [level + 4, level + 6, level + 8, level + 10];
  addQuestion(rows, category, phase, 'Statistics', `Find the mean of ${values.join(', ')}.`, (values.reduce((sum, value) => sum + value, 0) / values.length), [level + 6, level + 8, level + 10], 'B');
  addQuestion(rows, category, phase, 'Statistics', `Find the mode of this data: ${b}, ${c}, ${b}, ${b + 2}, ${c}.`, b, [c, b + 2, b + c], 'A');
  addQuestion(rows, category, phase, 'Statistics', `Find the range of this data: ${level + 1}, ${level + 9}, ${level + 4}, ${level + 13}.`, 12, [10, 11, 13], 'C');
  addQuestion(rows, category, phase, 'Statistics', `In a class survey, ${b} students like football, ${d} like basketball and ${a} like athletics. How many students were surveyed in all?`, b + d + a, [b + d, d + a, b + a], 'D');

  for (let i = 1; i <= 6; i++) {
    const data = [level + i, level + i + 2, level + i + 4, level + i + 6];
    const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
    addQuestion(rows, category, phase, 'Statistics', `Find the mean of ${data.join(', ')}.`, mean, [mean - 1, mean + 1, mean + 2], correctIdFor(i + 21));
  }

  // Ten Geometry questions
  const length = level + 8;
  const width = level + 3;
  addQuestion(rows, category, phase, 'Geometry', `Find the perimeter of a rectangle with length ${length} cm and width ${width} cm.`, 2 * (length + width), [length + width, length * width, 2 * length + width], 'B');
  addQuestion(rows, category, phase, 'Geometry', `Find the area of a square with side ${level + 6} cm.`, Math.pow(level + 6, 2), [2 * (level + 6), 4 * (level + 6), Math.pow(level + 6, 2) + 4], 'A');
  addQuestion(rows, category, phase, 'Geometry', `Two angles of a triangle are ${40 + level}° and ${60 + level}°. Find the third angle.`, 180 - ((40 + level) + (60 + level)), [70 - level, 80 - level, 90 - level], 'C');

  for (let i = 1; i <= 7; i++) {
    const rectL = level + i + 6;
    const rectW = level + i + 2;
    const correct = i % 2 === 0 ? rectL * rectW : 2 * (rectL + rectW);
    const text = i % 2 === 0
      ? `Find the area of a rectangle with length ${rectL} cm and width ${rectW} cm.`
      : `Find the perimeter of a rectangle with length ${rectL} cm and width ${rectW} cm.`;
    addQuestion(rows, category, phase, 'Geometry', text, correct, [rectL + rectW, rectL * rectW + rectW, 2 * rectL + rectW], correctIdFor(i + 28));
  }

  return rows.slice(0, 50);
}

export function buildSeedQuestions(phase = 'Stage 1') {
  return DEFAULT_CATEGORIES.flatMap(category => buildSeedQuestionsForCategory(category, phase));
}
