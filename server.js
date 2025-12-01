// server.js - FIXED BACKEND FOR VERCEL

const express = require('express');
const crypto = require('crypto');
const { Client, Databases, Query } = require('node-appwrite');
const app = express();

// ✅ CRITICAL: Parse JSON body
app.use(express.json());

// ✅ CORS for development
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

// ✅ Momo Config - MUST MATCH payment.ts
const MOMO_CONFIG = {
    partnerCode: 'MOMOEWN820251130',
    accessKey: 'bxpIpXsB5FM0vn5R',
    secretKey: '6YIKQUjACi9LBHerKQvTZXcBkEY3NEpq',
};

// ✅ Appwrite Config
const APPWRITE_CONFIG = {
    endpoint: 'https://nyc.cloud.appwrite.io/v1',
    projectId: '69230ad2001fb8f2aee4',
    databaseId: '68629ae60038a7c61fe4',
    ordersCollectionId: 'orders',
    // ⚠️ SET THIS IN VERCEL ENVIRONMENT VARIABLES
    apiKey: process.env.APPWRITE_API_KEY || 'standard_c9f94d4e2c13a8df7325ae8914bdb6c4f17d92af7461d2bae9e4cc0bdac9395bbabfd5b87f9ab9eb596c1ea9cac286442d954c5fec5eb795f47879bce69539ed12224544b1d5f50d597536a8a06c50df0bddbd91f6c8b0aca3739eb2b2131fd89bf1b7bc86585cdd52c161e22cb602278e5d45d7b87ebbdfdee3be3b8d1df7a1',
};

/**
 * Health check endpoint
 */
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Momo Webhook Server Running',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || 'development'
    });
});

/**
 * ✅ WEBHOOK ENDPOINT - Momo calls this when payment succeeds
 */
app.post('/api/momo-webhook', async (req, res) => {
    try {
        console.log('📥 Webhook received:', JSON.stringify(req.body, null, 2));

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

        // ❌ Check missing fields
        if (!orderId || !transId || resultCode === undefined) {
            console.error('❌ Missing required fields');
            return res.status(400).json({ 
                message: 'Missing required fields',
                resultCode: 1 
            });
        }

        // 1️⃣ Verify signature
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

        console.log('🔐 Expected signature:', expectedSignature);
        console.log('🔐 Received signature:', signature);

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

        // 3️⃣ Update order
        const updated = await updateOrderPaymentStatus(orderId, transId, 'paid');

        if (!updated) {
            console.error('❌ Failed to update order');
            return res.status(500).json({ 
                message: 'Failed to update order',
                resultCode: 1 
            });
        }

        // 4️⃣ SUCCESS - Return to Momo
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
 * Update order payment status in Appwrite
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

        // Find order by order_number
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

// ✅ Start server (for local testing)
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📡 Webhook: http://localhost:${PORT}/api/momo-webhook`);
    });
}

// ✅ Export for Vercel serverless
module.exports = app;