const express = require('express');
const mongoose = require('mongoose');
const app = express();

// Connection string của Atlas
const connectionString = "mongodb+srv://mypas1234:mypas1234@cluster0.1pfctvy.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(connectionString)
  .then(() => console.log('✅ Kết nối MongoDB Atlas thành công!'))
  .catch(error => console.error('❌ Lỗi kết nối MongoDB Atlas:', error));

// Schema mẫu
const UserSchema = new mongoose.Schema({
  name: String,
  age: Number,
});
const User = mongoose.model('User', UserSchema);

// Route test
app.get('/', async (req, res) => {
  const user = new User({ name: "Test User", age: 20 });
  await user.save();
  res.send("Đã lưu 1 user vào MongoDB Atlas!");
});

// Start server
app.listen(3000, () => {
  console.log("🚀 Server chạy tại http://localhost:3000");
});