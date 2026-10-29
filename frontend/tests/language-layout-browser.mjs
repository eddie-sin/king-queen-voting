// Check English line/width budgets and Burmese text separation, including dialogs.
process.env.LANGUAGE_LAYOUT_AUDIT = '1';
process.env.LANGUAGE_LAYOUT_ASSERT = '1';
process.env.LANGUAGE_TEST_WIDTHS ||= '1440,1280,1024,768,390,320';
await import('./language-browser.mjs');
