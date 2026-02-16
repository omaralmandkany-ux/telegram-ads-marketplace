// Upload API - handles file uploads to Firebase Storage using base64

import { Request, Response } from 'express';
import { getStorage } from 'firebase-admin/storage';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

const storage = getStorage();
// Use explicit bucket name based on project ID
const bucket = storage.bucket(`${config.firebaseProjectId}.firebasestorage.app`);

export async function uploadFile(req: Request, res: Response): Promise<void> {
    try {
        const { data, mimeType, filename } = req.body;

        if (!data) {
            res.status(400).json({ success: false, error: 'No file data provided' });
            return;
        }

        // Validate mime type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        const actualMimeType = mimeType || 'image/jpeg';

        if (!allowedTypes.includes(actualMimeType)) {
            res.status(400).json({ success: false, error: 'Only image files are allowed' });
            return;
        }

        // Remove data URL prefix if present
        const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        // Generate unique filename
        const extension = actualMimeType.split('/')[1] || 'jpg';
        const uniqueFilename = `uploads/${uuidv4()}.${extension}`;
        const fileRef = bucket.file(uniqueFilename);

        // Upload to Firebase Storage
        await fileRef.save(buffer, {
            metadata: {
                contentType: actualMimeType,
            },
        });

        // Make file public
        await fileRef.makePublic();

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${uniqueFilename}`;

        res.json({
            success: true,
            data: {
                url: publicUrl,
                filename: uniqueFilename
            }
        });
    } catch (error: any) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: error.message || 'Upload failed' });
    }
}
