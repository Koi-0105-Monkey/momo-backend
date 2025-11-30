# Momo Webhook Backend

Backend để nhận webhook từ Momo khi thanh toán thành công.

## Setup

1. Install dependencies:
```bash
   npm install
```

2. Set environment variables on Vercel:
   - `APPWRITE_API_KEY`
   - `ORDERS_COLLECTION_ID`

3. Deploy to Vercel:
```bash
   vercel --prod
```

## Webhook URL
https://your-project.vercel.app/api/momo-webhook