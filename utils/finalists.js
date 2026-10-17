const { randomInt } = require("crypto");

exports.selectFinalists = (candidates, limit = 5, draw = randomInt) => {
  const sorted = [...candidates].sort((a, b) => b.votes - a.votes || String(a.candidate).localeCompare(String(b.candidate)));
  const finalists = [];
  for (let index = 0; index < sorted.length && finalists.length < limit;) {
    let end = index + 1;
    while (end < sorted.length && sorted[end].votes === sorted[index].votes) end += 1;
    const tied = sorted.slice(index, end);
    const remaining = limit - finalists.length;
    const needsDraw = tied.length > remaining;
    if (needsDraw) {
      // Fisher-Yates uses unbiased cryptographic draws, including ties of 3+.
      for (let i = tied.length - 1; i > 0; i -= 1) {
        const j = draw(i + 1);
        [tied[i], tied[j]] = [tied[j], tied[i]];
      }
    }
    finalists.push(...tied.slice(0, remaining).map((entry) => ({ ...entry, selectedByTieBreak: needsDraw })));
    index = end;
  }
  return finalists;
};
