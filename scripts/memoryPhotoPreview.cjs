// The old preview provisioned retired roles and a standalone legacy database.
// It must not be used with the manual-controls schema.
console.error('Legacy Memory Photo preview retired. Use the v2 local setup in README.md. Automated preview setup will be revisited in the testing phase.');
process.exitCode = 1;
