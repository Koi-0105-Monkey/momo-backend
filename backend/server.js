// backend/server.js - PHIÊN BẢN ĐÚNG

const express = require('express');
const crypto = require('crypto');
const { Client, Databases, Query } = require('node-appwrite');
const app = express();

app.use(express.json());

// ✅ Momo Config - PHẢI GIỐNG payment.ts
const MOMO_CONFIG = {
    partnerCode: 'MOMOEWN820251130',
    accessKey: 'bxpIpXsB5FM0vn5R',
    secretKey: '6YIKQUjACi9LBHerKQvTZXcBkEY3NEpq',
};

// ✅ Appwrite Config
const APPWRITE_CONFIG = {
    endpoint: 'https://sgp.cloud.appwrite.io/v1',
    projectId: '6927c3e3000eb4b8dcce',
    databaseId: '6927c468001041ff0fc7',
    ordersCollectionId: process.env.ORDERS_COLLECTION_ID || 'orders',
    apiKey: process.env.APPWRITE_API_KEY, // ⚠️ Phải set trong Vercel Environment Variables
};

/**
 * Health check endpoint
 */
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Momo Webhook Server Running',
        timestamp: new Date().toISOString()
    });
});

/**
 * ✅ Webhook endpoint - Momo gọi khi thanh toán thành công
 */
app.post('/api/momo-webhook', async (req, res) => {
    try {
        console.log('📥 Received Momo webhook:', JSON.stringify(req.body, null, 2));

        const {
            partnerCode,
            orderId,
            requestId,
            amount,
            orderInfo,
            orderType,
            transId,
            resultCode,
            message,
            payType,
            responseTime,
            extraData,
            signature,
        } = req.body;

        // ❌ Kiểm tra thiếu dữ liệu
        if (!orderId || !transId || resultCode === undefined) {
            console.error('❌ Missing required fields');
            return res.status(400).json({ 
                message: 'Missing required fields',
                resultCode: 1 
            });
        }

        // 1️⃣ Verify signature để đảm bảo request từ Momo
        const rawSignature = 
            `accessKey=${MOMO_CONFIG.accessKey}` +
            `&amount=${amount}` +
            `&extraData=${extraData}` +
            `&message=${message}` +
            `&orderId=${orderId}` +
            `&orderInfo=${orderInfo}` +
            `&orderType=${orderType}` +
            `&partnerCode=${partnerCode}` +
            `&payType=${payType}` +
            `&requestId=${requestId}` +
            `&responseTime=${responseTime}` +
            `&resultCode=${resultCode}` +
            `&transId=${transId}`;

        const expectedSignature = crypto
            .createHmac('sha256', MOMO_CONFIG.secretKey)
            .update(rawSignature)
            .digest('hex');

        if (signature !== expectedSignature) {
            console.error('❌ Invalid signature!');
            return res.status(403).json({ 
                message: 'Invalid signature',
                resultCode: 97 
            });
        }

        // 2️⃣ Check payment status
        if (resultCode !== 0) {
            console.error('❌ Payment failed:', message);
            
            // Vẫn update order status = failed
            await updateOrderPaymentStatus(orderId, transId, 'failed');
            
            return res.status(200).json({ 
                message: 'Payment failed but processed',
                resultCode: 0 
            });
        }

        console.log('✅ Payment verified!', {
            orderId,
            transId,
            amount: `${amount.toLocaleString('vi-VN')}đ`,
        });

        // 3️⃣ Update order in Appwrite
        const updated = await updateOrderPaymentStatus(orderId, transId, 'paid');

        if (!updated) {
            console.error('❌ Failed to update order');
            return res.status(500).json({ 
                message: 'Failed to update order',
                resultCode: 1 
            });
        }

        // 4️⃣ TODO: Send push notification to user
        // await sendPushNotification(orderId);

        // 5️⃣ Response về Momo (BẮT BUỘC trả về resultCode: 0)
        return res.status(200).json({
            message: 'OK',
            resultCode: 0,
        });

    } catch (error) {
        console.error('❌ Webhook error:', error);
        return res.status(500).json({ 
            message: 'Internal server error',
            resultCode: 1 
        });
    }
});

/**
 * Update order payment status trong Appwrite
 */
async function updateOrderPaymentStatus(orderId, transId, status) {
    try {
        if (!APPWRITE_CONFIG.apiKey) {
            console.error('❌ APPWRITE_API_KEY not set!');
            return false;
        }

        const client = new Client()
            .setEndpoint(APPWRITE_CONFIG.endpoint)
            .setProject(APPWRITE_CONFIG.projectId)
            .setKey(APPWRITE_CONFIG.apiKey);

        const databases = new Databases(client);

        // Tìm order theo order_number
        const orders = await databases.listDocuments(
            APPWRITE_CONFIG.databaseId,
            APPWRITE_CONFIG.ordersCollectionId,
            [Query.equal('order_number', orderId)]
        );

        if (orders.documents.length === 0) {
            console.error('❌ Order not found:', orderId);
            return false;
        }

        const order = orders.documents[0];

        // Update payment status
        await databases.updateDocument(
            APPWRITE_CONFIG.databaseId,
            APPWRITE_CONFIG.ordersCollectionId,
            order.$id,
            {
                payment_status: status,
                transaction_id: transId,
                paid_at: status === 'paid' ? new Date().toISOString() : '',
                order_status: status === 'paid' ? 'confirmed' : 'pending',
            }
        );

        console.log(`✅ Order ${orderId} updated to ${status}`);
        return true;

    } catch (error) {
        console.error('❌ Update order error:', error.message);
        return false;
    }
}

/**
 * TODO: Gửi push notification đến app
 */
async function sendPushNotification(orderId) {
    // Implement với Expo Push Notification hoặc Firebase
    console.log('📱 TODO: Send push notification for order:', orderId);
}

// Start server (Vercel serverless không cần, nhưng để test local)
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Webhook server running on http://localhost:${PORT}`);
        console.log(`📡 Webhook URL: http://localhost:${PORT}/api/momo-webhook`);
    });
}

// Export cho Vercel serverless
module.exports = app;