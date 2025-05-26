import jwt from 'jsonwebtoken';
import dotenv from "dotenv";

import {isAdmin} from "./helpers.js";

dotenv.config();

const JWT_SECRET = 'a0aa12b6e5053904cce53cbf718c8f6d8a6d3d4cdf33e61e1f7ea88b6e0b1f07e78e7de91e556a524a2cef972176c3c705ebb8aadb23fcb9f700e455ccb77827';
const AUTH_ENABLED = true;
const bypassRoutes = ['/','/login', '/register'];

const extractTokenFromHeader = (req) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return null;
    }

    if (authHeader.toLowerCase().startsWith('bearer ')) {
        const token = authHeader.split(' ')[1];
        return token || null;
    }

    return authHeader;
};

export const authMiddleware = (req, res, next) => {

    if (bypassRoutes.includes(req.path)) {
        console.log(`[AuthMiddleware] Skipped: "${req.path}" is a public route.`);
        return next();
    }

    if (!AUTH_ENABLED) {
        console.log('[AuthMiddleware] Skipped: Authentication is globally disabled (AUTH_ENABLED=false).');
        return next();
    }

    const token = extractTokenFromHeader(req);

    if (!token) {
        return res.status(401).send({
            success: false,
            error: 'Unauthorized',
            message: 'No token provided.'
        });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(403).send({
            success: false,
            message: 'Forbidden',
            error: err?.message,
        });
    }
};

export const isAdminMiddleware = async (req, res, next) => {
    console.log('[IsAdminMiddleware] IsAdmin middleware invoked.');

    if (!AUTH_ENABLED) {
        console.log('[IsAdminMiddleware] Skipped: IsAdmin middleware is globally disabled (AUTH_ENABLED=false).');
        return next();
    }

    try {
        const isAdminCheck = await isAdmin(req.user.id);
        console.log('isAdminCheck:', isAdminCheck);

        if (!isAdminCheck?.isAdmin) {
            return res.status(401).send({
                success: false,
                error: 'Unauthorized',
                message: 'You are not authorized to perform this action.'
            });
        }

        next();
    } catch (error) {
        console.error('Error during admin check:', error);
        return res.status(500).send({
            success: false,
            error: 'InternalServerError',
            message: 'An error occurred while checking admin privileges.'
        });
    }
};
