const express = require('express');
const path = require('path');
const multer = require('multer');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const mongoose = require('mongoose');
const fs = require('fs');

const app = express();
const port = 3000;

// ====== QUẢN LÝ LƯỢT TRUY CẬP ======
const visitsFile = path.join(__dirname, "visits.json");
function getVisits() {
    try {
        const data = fs.readFileSync(visitsFile, "utf8");
        return JSON.parse(data).totalVisits || 0;
    } catch {
        return 0;
    }
}
function saveVisits(count) {
    fs.writeFileSync(visitsFile, JSON.stringify({ totalVisits: count }, null, 2));
}
let totalVisits = getVisits();

// ====== KẾT NỐI MONGODB ======
mongoose.connect('mongodb+srv://mypas1234:mypas1234@cluster0.1pfctvy.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ Kết nối MongoDB thành công.'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// ====== SCHEMAS ======
const userSchema = new mongoose.Schema({
    googleId: { type: String, required: true },
    displayName: { type: String, required: true },
    email: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    role: { type: String, enum: ['user', 'admin'], default: 'user' }
});
const User = mongoose.model('User', userSchema);

const skinSchema = new mongoose.Schema({
    title: { type: String, required: true },
    game: { type: String, required: true },
    type: { type: String, required: true },
    author: { type: String, required: true },
    description: { type: String },
    demoImageUrl: { type: String, required: true },
    inGameImageUrls: [String],
    skinFileUrl: { type: String, required: true },
    downloads: { type: Number, default: 0 },
    rejectionReason: { type: String },
    approved: { type: Boolean, default: false },
    rejected: { type: Boolean, default: false },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
    likers: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'User',
        default: []
    }
});
const Skin = mongoose.model('Skin', skinSchema);

// ====== MULTER ======
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        const newFilename = uniqueSuffix + fileExtension;
        cb(null, newFilename);
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 }
});

// ====== MIDDLEWARE ======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sửa lỗi ở đây: Session phải trước Passport
app.use(session({
    secret: 'secret_key_ngau_nhien',
    resave: false,
    saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());

// BƯỚC 2: ĐẾM TRUY CẬP
app.use((req, res, next) => {
    if (req.path === "/" || req.path.startsWith('/index.html')) {
        if (!req.session.visited) {
            let currentVisits = getVisits();
            currentVisits++;
            saveVisits(currentVisits);
            req.session.visited = true;
        }
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ====== PASSPORT GOOGLE ======
require('dotenv').config(); // đảm bảo có dòng này ở đầu file (nếu chưa có)

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,       // lấy từ biến môi trường
    clientSecret: process.env.GOOGLE_CLIENT_SECRET, // lấy từ biến môi trường
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "https://truck24-14.onrender.com/auth/google/callback"
},
    async (accessToken, refreshToken, profile, done) => {
        try {
            let user = await User.findOne({ googleId: profile.id });
            if (!user) {
                const role = profile.emails[0].value === 'alunakuncl@gmail.com' ? 'admin' : 'user';
                console.log(`Gán quyền ${role} cho tài khoản:`, profile.emails[0].value);
                user = new User({
                    googleId: profile.id,
                    displayName: profile.displayName,
                    email: profile.emails[0].value,
                    role
                });
                await user.save();
            }
            done(null, user);
        } catch (err) {
            done(err, null);
        }
    }
));

passport.serializeUser((user, done) => done(null, user.id));

// Thêm log vào deserialize để kiểm tra
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        console.log('User deserialized:', user ? 'Found' : 'Not Found');
        done(null, user);
    } catch (err) {
        console.error('❌ Lỗi deserialize user:', err);
        done(err, null);
    }
});

// ====== ROUTES AUTH ======
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => res.redirect('/'));
app.get('/logout', (req, res, next) => {
    req.logout(err => {
        if (err) return next(err);
        res.redirect('/');
    });
});
app.get('/auth-status', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ isLoggedIn: true, displayName: req.user.displayName });
    } else {
        res.json({ isLoggedIn: false });
    }
});
app.get('/api/me', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({
            isLoggedIn: true,
            id: req.user._id,
            googleId: req.user.googleId,
            displayName: req.user.displayName,
            email: req.user.email,
            role: req.user.role,
            createdAt: req.user.createdAt
        });
    } else {
        res.json({ isLoggedIn: false });
    }
});

// ====== API SKINS ======
app.get('/api/skins', async (req, res) => {
    try {
        const skins = await Skin.find({ approved: true }).sort({ createdAt: -1 });

        const result = skins.map(skin => {
            const likers = Array.isArray(skin.likers) ? skin.likers : [];
            const isLikedByUser = req.isAuthenticated()
                ? likers.some(likerId => likerId.toString() === req.user._id.toString())
                : false;

            return {
                _id: skin._id,
                title: skin.title,
                author: skin.author,
                type: skin.type,
                game: skin.game,
                demoImageUrl: skin.demoImageUrl,
                likes: likers.length,
                isLikedByUser
            };
        });

        res.json(result);
    } catch (err) {
        console.error("🔥 Lỗi API /api/skins:", err);
        res.status(500).json({ error: 'Lỗi khi tải skins từ database.', message: err.message });
    }
});

// API Like / Unlike skin
app.post('/api/skins/:id/like', async (req, res) => {
    // Thêm log ở đây để kiểm tra
    console.log('---------------------------------');
    console.log('Request to /like received.');
    console.log('Is authenticated:', req.isAuthenticated());
    console.log('User object:', req.user); // Rất quan trọng!

    if (!req.isAuthenticated()) {
        return res.status(401).send('Bạn cần đăng nhập.');
    }

    
    try {
        const skinId = req.params.id;
        const userId = req.user._id;

        console.log('Skin ID:', skinId);
        console.log('User ID:', userId);

        const skin = await Skin.findById(skinId);
        if (!skin) {
            return res.status(404).send('Không tìm thấy skin.');
        }

        if (!skin.authorId) {
            // Nếu skin thiếu authorId, thêm nó vào.
            // Giả định `author` trong skin khớp với `displayName` của user.
            const authorUser = await User.findOne({ displayName: skin.author });
            if (authorUser) {
                skin.authorId = authorUser._id;
            } else {
                // Nếu không tìm thấy tác giả, gán cho admin
                skin.authorId = userId; // Gán ID của người like
            }
        }

        console.log('Likers trước khi cập nhật:', skin.likers.map(id => id.toString()));

        // Sử dụng .equals() để so sánh ObjectId
        const userLikedIndex = skin.likers.findIndex(likerId => likerId.equals(userId));

        if (userLikedIndex === -1) {
            skin.likers.push(userId);
        } else {
            skin.likers.splice(userLikedIndex, 1);
        }

        await skin.save();

        console.log('Likers sau khi cập nhật:', skin.likers.map(id => id.toString()));

        res.json({
            likes: skin.likers.length,
            isLikedByUser: userLikedIndex === -1
        });
    } catch (err) {
        console.error("❌ Lỗi khi like skin:", err);
        res.status(500).send('Lỗi khi xử lý like.');
    }
});

// Admin: xem danh sách skin chưa phê duyệt
app.get('/api/admin/skins', async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== 'admin') {
        return res.status(403).send('Bạn không có quyền.');
    }
    try {
        const skins = await Skin.find({ approved: false, rejected: false }).sort({ createdAt: -1 });
        res.json(skins);
    } catch (err) {
        res.status(500).send('Lỗi khi tải skins chưa duyệt.');
    }
});

// Phê duyệt skin
app.post('/api/skins/:id/approve', async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== 'admin') {
        return res.status(403).send('Bạn không có quyền phê duyệt.');
    }
    try {
        await Skin.findByIdAndUpdate(req.params.id, {
            approved: true,
            rejectionReason: null,
            rejected: false
        });
        res.status(200).send('Skin đã được phê duyệt!');
    } catch (err) {
        res.status(500).send('Lỗi khi phê duyệt.');
    }
});

// Từ chối skin (cập nhật rejectionReason)
app.post('/api/skins/:id/reject', async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== 'admin') {
        return res.status(403).send('Không có quyền từ chối.');
    }
    try {
        const skinId = req.params.id;
        const reason = req.body.reason || 'Không rõ lý do';

        await Skin.findByIdAndUpdate(skinId, {
            rejected: true,
            rejectionReason: reason,
            approved: false
        });

        res.status(200).send('Từ chối thành công');
    } catch (err) {
        res.status(500).send('Lỗi server.');
    }
});

// Chi tiết skin
app.get('/api/skins/:id', async (req, res) => {
    try {
        const skin = await Skin.findById(req.params.id);
        if (!skin) return res.status(404).send('Không tìm thấy skin.');
        const skinObject = skin.toObject();
        res.json(skinObject);
    } catch (err) {
        res.status(500).send('Lỗi khi tìm skin.');
    }
});

// Các API khác...
app.get('/api/user-has-skins', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.json({ hasSkins: false });
    }
    if (req.user.role === 'admin') {
        return res.json({ hasSkins: false });
    }
    try {
        const count = await Skin.countDocuments({ authorId: req.user._id });
        res.json({ hasSkins: count > 0 });
    } catch (err) {
        res.status(500).json({ hasSkins: false });
    }
});

app.get('/my-skins', (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(path.join(__dirname, 'public', 'my-skins.html'));
    } else {
        res.redirect('/');
    }
});

app.get('/api/my-skins', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Bạn chưa đăng nhập.' });
    }
    try {
        const skins = await Skin.find({ authorId: req.user._id }).sort({ createdAt: -1 });
        res.json(skins);
    } catch (err) {
        console.error("Lỗi API /api/my-skins:", err);
        res.status(500).json({ error: 'Lỗi khi tải skins của bạn.' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const totalSkins = await Skin.countDocuments();
        const totalUsers = await User.countDocuments();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const newSkinsToday = await Skin.countDocuments({ createdAt: { $gte: today } });
        const downloadStats = await Skin.aggregate([
            { $group: { _id: null, totalDownloads: { $sum: "$downloads" } } }
        ]);
        const totalDownloads = downloadStats.length > 0 ? downloadStats[0].totalDownloads : 0;
        const totalVisits = getVisits();
        res.json({ totalSkins, totalUsers, newSkinsToday, totalDownloads, totalVisits });
    } catch (err) {
        res.status(500).send('Lỗi khi lấy thống kê.');
    }
});

// ====== UPLOAD SKIN ======
const cpUpload = upload.fields([
    { name: 'demoImage', maxCount: 1 },
    { name: 'inGameImages', maxCount: 2 },
    { name: 'skinFile', maxCount: 1 }
]);
app.post('/upload-skin', cpUpload, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send('Bạn cần đăng nhập.');
    if (!req.files) return res.status(400).send('Không tìm thấy file.');
    const { skinTitle, skinType, skinGame, description } = req.body;
    const uploadedFiles = req.files;

    const demoImage = uploadedFiles['demoImage'] ? uploadedFiles['demoImage'][0] : null;
    const inGameImages = uploadedFiles['inGameImages'] || [];
    const skinFile = uploadedFiles['skinFile'] ? uploadedFiles['skinFile'][0] : null;
    try {
        const newSkin = new Skin({
            title: skinTitle,
            type: skinType,
            game: skinGame,
            description,
            author: req.user.displayName,
            authorId: req.user._id,
            demoImageUrl: demoImage ? `/uploads/${demoImage.filename}` : null,
            inGameImageUrls: inGameImages.map(file => `/uploads/${file.filename}`),
            skinFileUrl: skinFile ? `/uploads/${skinFile.filename}` : null,
            approved: req.user.role === 'admin'
        });
        await newSkin.save();
        res.redirect('/');
    } catch (err) {
        console.error("❌ Lỗi khi upload skin:", err);
        res.status(500).send('Lỗi khi lưu skin.');
    }
});

// ====== ROUTES HTML ======
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/skin/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'skin-detail.html')));
app.get('/admin', (req, res) => {
    if (req.isAuthenticated() && req.user.role === 'admin') {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else {
        res.redirect('/');
    }
});

// ====== SERVER ======
app.listen(port, () => console.log(`✅ Server chạy tại http://localhost:${port}`));
