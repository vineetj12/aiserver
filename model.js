const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    username: String,
    password: String,
});

const scoreSchema = new mongoose.Schema({
    username: String,
    lastscore: String,
});

const qaSchema = new mongoose.Schema({
    username: String,
    questionanswer: String,
});

const qnoSchema = new mongoose.Schema({
    username: String,
    qno: String,
});
const imageSchema = new mongoose.Schema({
    username: String,
    image: String
  });
  
  const Image = mongoose.model("Image", imageSchema);
  const User = mongoose.model("User", userSchema);
  const Score = mongoose.model("Score", scoreSchema);
  const QA = mongoose.model("QA", qaSchema);
  const Qno = mongoose.model("Qno", qnoSchema);
  
  module.exports = { User, Score, QA, Qno, Image };