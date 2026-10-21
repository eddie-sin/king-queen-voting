export function lanternMetadata(value = {}) {
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (!title) throw new Error('Lantern title is required.');
  if (title.length > 120) throw new Error('Lantern title must be 120 characters or fewer.');
  if (description.length > 1000) throw new Error('Lantern description must be 1000 characters or fewer.');
  return { title, description };
}

export function lanternFormData(value, files) {
  const metadata = lanternMetadata(value);
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Choose exactly one image for each lantern.');
  const data = new FormData();
  data.append('section', 'lantern'); data.append('title', metadata.title); data.append('description', metadata.description);
  data.append('images', files[0]);
  return data;
}
