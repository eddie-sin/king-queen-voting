module.exports = handler => async (req, res, next) => {
  req.uploadProcessing = true;
  try { await handler(req, res, next); } catch (error) { next(error); }
  finally { req.releaseUpload?.(); }
};
