import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export async function getChatRooms(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized Access' });
        }
        
    } catch (error) {
        console.error('Error fetching chat rooms:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}