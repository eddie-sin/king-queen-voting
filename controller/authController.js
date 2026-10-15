
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const User = require("../model/usersModel");
const VotingCredential = require("../model/voting_credentialsModel");

exports.register = async (req, res) => {
  let savedUser;

  try {
    const { fullName, batchNumber, email, password } = req.body;

    if (
      !fullName?.trim() ||
      !batchNumber?.trim() ||
      !email?.trim() ||
      !password
    ) {
      return res.status(400).json({
        status: "fail",
        message: "Full name, batch number, email, and password are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        status: "fail",
        message: "Password must be at least 8 characters.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        status: "fail",
        message: "Email is already registered.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    savedUser = await User.create({
      fullName: fullName.trim(),
      batchNumber: batchNumber.trim(),
      email: normalizedEmail,
      passwordHash,
      credentialIssued: true,
    });

    const votingKey = crypto.randomBytes(32).toString("hex");

    const codeHash = crypto
      .createHash("sha256")
      .update(votingKey)
      .digest("hex");

    try {
      await VotingCredential.create({ codeHash });
    } catch (error) {
      await User.deleteOne({ _id: savedUser._id });
      throw error;
    }

    return res.status(201).json({
      status: "success",
      message: "Account created successfully.",
      data: {
        user: {
          id: savedUser._id,
          fullName: savedUser.fullName,
          batchNumber: savedUser.batchNumber,
          email: savedUser.email,
        },
        votingKey,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        status: "fail",
        message: "Email is already registered.",
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      status: "error",
      message: "Could not create account.",
    });
  }
};


exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({
        status: "fail",
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("+passwordHash");

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({
        status: "fail",
        message: "Invalid email or password.",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        status: "fail",
        message: "This account is disabled.",
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const jwt = require("jsonwebtoken");

    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "5h" }
    );

    return res.status(200).json({
      status: "success",
      message: "Login successful.",
      data: {
        token,
        tokenType: "Bearer",
        expiresIn: process.env.JWT_EXPIRES_IN || "5h",
        user: {
          id: user._id,
          fullName: user.fullName,
          batchNumber: user.batchNumber,
          email: user.email,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      status: "error",
      message: "Could not log in.",
    });
  }
};


exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User not found.",
      });
    }

    return res.status(200).json({
      status: "success",
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          batchNumber: user.batchNumber,
          email: user.email,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Could not retrieve profile.",
    });
  }
};

