
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { BrevoClient } = require("@getbrevo/brevo");

const User = require("../model/usersModel");
const Admin = require("../model/adminsModel");
const VotingCredential = require("../model/voting_credentialsModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { hashVotingKey } = require("../utils/votingKey");
const { withElectionOperation } = require("../utils/election");

const brevo = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY,
});

const userResponse = (user) => ({
  id: user._id,
  email: user.email,
  emailVerified: user.emailVerified,
  hasVotedKing: user.hasVotedKing,
  hasVotedQueen: user.hasVotedQueen,
});

const tokenResponse = (payload) => ({
  token: jwt.sign(payload, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: process.env.JWT_EXPIRES_IN || "5h",
  }),
  tokenType: "Bearer",
  expiresIn: process.env.JWT_EXPIRES_IN || "5h",
});

exports.register = catchAsync(async (req, res) => {
  const { email, password } = req.body || {};

  if (
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    !password.trim()
  ) {
    throw new AppError("Email and password are required.", 400);
  }

  if (password.length < 8) {
    throw new AppError("Password must be at least 8 characters.", 400);
  }

  const normalizedEmail = email.trim();

if (normalizedEmail !== normalizedEmail.toLowerCase()) {
  throw new AppError("Email must contain lowercase letters only.", 400);
}

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
  throw new AppError("A valid email is required.", 400);
}

  if (normalizedEmail.endsWith("@example.com")) {
    throw new AppError("Please use a real email address.", 400);
  }

  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
    throw new AppError("Email verification is not configured.", 500);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const otp = crypto.randomInt(100000, 1000000).toString();
  const emailOtpHash = crypto
    .createHash("sha256")
    .update(otp)
    .digest("hex");

  const user = await withElectionOperation(
    "registration",
    async ({ onRollback }) => {
    const existingUser = await User.findOne({
  email: normalizedEmail,
});

if (existingUser) {
  if (existingUser.emailVerified) {
    throw new AppError("Email is already registered.", 409);
  }

  const previousPasswordHash = existingUser.passwordHash;
  const previousOtpHash = existingUser.emailOtpHash;
  const previousOtpExpires = existingUser.emailOtpExpires;

  onRollback(async () => {
    const update = {
      $set: {
        passwordHash: previousPasswordHash,
      },
    };

    if (previousOtpHash == null) {
      update.$unset = {
        emailOtpHash: 1,
        emailOtpExpires: 1,
      };
    } else {
      update.$set.emailOtpHash = previousOtpHash;
      update.$set.emailOtpExpires = previousOtpExpires;
    }

    await User.updateOne(
      { _id: existingUser._id, emailVerified: false },
      update
    );
  });

  existingUser.passwordHash = passwordHash;
  existingUser.emailOtpHash = emailOtpHash;
  existingUser.emailOtpExpires = new Date(Date.now() + 10 * 60 * 1000);

  await existingUser.save();

  await brevo.transactionalEmails.sendTransacEmail({
    subject: "Kings & Queens Voting - Email Verification",
    textContent:
      `Your new email verification code is: ${otp}\n\n` +
      "This code expires in 10 minutes. Do not share it with anyone.",
    sender: {
      name: "Kings & Queens Voting",
      email: process.env.BREVO_SENDER_EMAIL,
    },
    to: [{ email: normalizedEmail }],
  });

  return existingUser;
}

      const created = new User({
        email: normalizedEmail,
        passwordHash,
        credentialIssued: false,
        emailVerified: false,
        emailOtpHash,
        emailOtpExpires: new Date(Date.now() + 10 * 60 * 1000),
      });

    
     

      await created.save();

      await brevo.transactionalEmails.sendTransacEmail({
        subject: "Kings & Queens Voting - Email Verification",
        textContent:
          `Your email verification code is: ${otp}\n\n` +
          "This code expires in 10 minutes. Do not share it with anyone.",
        sender: {
          name: "Kings & Queens Voting",
          email: process.env.BREVO_SENDER_EMAIL,
        },
        to: [{ email: normalizedEmail }],
      });

      return created;
    }
  );

  res.status(201).json({
    status: "success",
    message:
      "Registration started. Check your email for the verification code. Keep your voting key securely; it is shown only once and cannot be recovered.",
    data: {
      user: userResponse(user),
      
    },
  });
});

exports.verifyEmail = catchAsync(async (req, res) => {
  const { email, otp } = req.body || {};

  if (
    typeof email !== "string" ||
    !email.trim() ||
    typeof otp !== "string" ||
    !/^\d{6}$/.test(otp)
  ) {
    throw new AppError("A valid email and six-digit OTP are required.", 400);
  }

  const user = await User.findOne({
    email: email.trim().toLowerCase(),
  }).select("+emailOtpHash +emailOtpExpires");

  if (!user) {
    throw new AppError("Invalid email or verification code.", 400);
  }

  if (user.emailVerified) {
    throw new AppError("This email is already verified.", 400);
  }

  if (
    !user.emailOtpHash ||
    !user.emailOtpExpires ||
    user.emailOtpExpires.getTime() < Date.now()
  ) {
    throw new AppError("Verification code is invalid or expired.", 400);
  }

  const submittedHash = crypto
    .createHash("sha256")
    .update(otp)
    .digest("hex");

  if (submittedHash !== user.emailOtpHash) {
    throw new AppError("Verification code is incorrect.", 400);
  }

  // Generate the voting key only after successful OTP verification.
  const votingKey = crypto.randomBytes(32).toString("hex");

  await withElectionOperation("registration", async ({ onRollback }) => {
    const existingCredential = await VotingCredential.findOne({
      codeHash: hashVotingKey(user._id, votingKey),
    });

    if (existingCredential) {
      throw new AppError("Could not generate a unique voting key. Please try again.", 500);
    }

    const credential = new VotingCredential({
      codeHash: hashVotingKey(user._id, votingKey),
      bindingVersion: 2,
    });

    onRollback(() =>
      VotingCredential.deleteOne({ _id: credential._id })
    );

    onRollback(async () => {
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            emailVerified: false,
            credentialIssued: false,
            emailOtpHash: user.emailOtpHash,
            emailOtpExpires: user.emailOtpExpires,
          },
        }
      );
    });

    await credential.save();

    user.emailVerified = true;
    user.credentialIssued = true;
    user.emailOtpHash = undefined;
    user.emailOtpExpires = undefined;
    await user.save();
  });

  res.status(200).json({
    status: "success",
    message: "Email verified successfully. Save your voting key securely; it is shown only once.",
    data: {
      user: userResponse(user),
      votingKey,
    },
  });
})
;

exports.login = catchAsync(async (req, res) => {
  const { email, password } = req.body || {};

  if (
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    !password
  ) {
    throw new AppError("Email and password are required.", 400);
  }

  const normalizedEmail = email.trim();

if (normalizedEmail !== normalizedEmail.toLowerCase()) {
  throw new AppError("Email must contain lowercase letters only.", 400);
}

const user = await User.findOne({
  email: normalizedEmail,
}).select("+passwordHash");

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("Invalid email or password.", 401);
  }

  if (user.status !== "active") {
    throw new AppError("This account is disabled.", 403);
  }

  if (!user.emailVerified) {
    throw new AppError("Please verify your email before logging in.", 403);
  }

  res.status(200).json({
    status: "success",
    message: "Login successful.",
    data: {
      ...tokenResponse({
        userId: user._id.toString(),
        role: "user",
      }),
      user: userResponse(user),
    },
  });
});

exports.adminLogin = catchAsync(async (req, res) => {
  const { username, password } = req.body || {};

  if (
    typeof username !== "string" ||
    !username.trim() ||
    typeof password !== "string" ||
    !password
  ) {
    throw new AppError("Username and password are required.", 400);
  }

  const admin = await Admin.findOne({
    username: username.trim(),
  }).select("+passwordHash");

  if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
    throw new AppError("Invalid username or password.", 401);
  }

  if (admin.status !== "active") {
    throw new AppError("This admin account is disabled.", 403);
  }

  res.status(200).json({
    status: "success",
    data: {
      ...tokenResponse({
        adminId: admin._id.toString(),
        role: "admin",
      }),
      admin: {
        username: admin.username,
        role: admin.role,
      },
    },
  });
});

exports.getMe = catchAsync(async (req, res) => {
  res.status(200).json({
    status: "success",
    data: { user: userResponse(req.user) },
  });
});
