const router = require('express').Router();
const controller = require('../controller/authController');
const auth = require('../middleware/authMiddleware');
const limit = require('../middleware/authRateLimit');
const student = require('../controller/studentAuthController');
const guard = require('../utils/accounts/security').guard;
router.get('/config', limit('config'), student.config);
router.get('/pending', limit('config'), student.pending);
for (const [path,handler] of Object.entries({
 '/register':student.register, '/register/start':student.register, '/register/verify':student.verifyRegistration,
 '/login':student.login,'/logout':student.logout,'/google/start':student.googleStart,'/google/complete':student.googleComplete,
 '/google/link/verify':student.verifyLink,'/otp/resend':student.resend,
 '/password/recovery/start':student.recovery,'/password/recovery/verify':student.verifyRecovery,'/password/recovery/complete':student.completeRecovery
})) router.post(path,guard,limit(path.includes('register')?'register':'student'),handler);
router.post('/admin/login', limit('staff'), controller.adminLogin);
router.get('/admin/me', auth.staff, controller.getAdminMe);
router.get('/me', auth, student.me);
module.exports = router;
