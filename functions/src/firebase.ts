// Firebase Admin initialization and Firestore utilities

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

export const db = admin.firestore();
export const auth = admin.auth();
export const storage = admin.storage();
export { admin, Timestamp };

// Helper to get server timestamp
export const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

// Helper to convert to Timestamp
export const toTimestamp = (date: Date): Timestamp => {
    return Timestamp.fromDate(date);
};

// Helper to add hours to current time
export const hoursFromNow = (hours: number): Timestamp => {
    const date = new Date();
    date.setHours(date.getHours() + hours);
    return Timestamp.fromDate(date);
};

// Batch operations helper
export class BatchHelper {
    private batch: admin.firestore.WriteBatch;
    private operationCount: number;
    private readonly maxOperations = 500;

    constructor() {
        this.batch = db.batch();
        this.operationCount = 0;
    }

    private async commitIfNeeded(): Promise<void> {
        if (this.operationCount >= this.maxOperations) {
            await this.batch.commit();
            this.batch = db.batch();
            this.operationCount = 0;
        }
    }

    set(ref: admin.firestore.DocumentReference, data: unknown): void {
        this.batch.set(ref, data);
        this.operationCount++;
    }

    update(ref: admin.firestore.DocumentReference, data: unknown): void {
        this.batch.update(ref, data as admin.firestore.UpdateData<unknown>);
        this.operationCount++;
    }

    delete(ref: admin.firestore.DocumentReference): void {
        this.batch.delete(ref);
        this.operationCount++;
    }

    async commit(): Promise<void> {
        if (this.operationCount > 0) {
            await this.batch.commit();
        }
    }
}

// Transaction helper
export const runTransaction = <T>(
    updateFunction: (transaction: admin.firestore.Transaction) => Promise<T>
): Promise<T> => {
    return db.runTransaction(updateFunction);
};
