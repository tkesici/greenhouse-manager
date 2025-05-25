const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const JWT_SECRET = process.env.JWT_SECRET;

dotenv.config();

const authMiddleware = (req, res, next) => {
    const authEnabled = process.env.AUTH_ENABLED === 'true';
    if (!authEnabled) {
        console.log('[AuthMiddleware] AUTH_ENABLED=false → Auth middleware skipped');
        return next();
    }
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).send('Missing token');

    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(403).send('Invalid token');
    }
};

const checkRole = (role) => (req, res, next) => {
    if (req.user.role !== role) return res.sendStatus(403);
    next();
};

module.exports = {
    authenticateUser: authMiddleware,
    checkRole
};
