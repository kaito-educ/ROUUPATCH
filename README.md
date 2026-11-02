# ROUUPATCH — TikTok Uploader

A TikTok-only video uploader built with Node.js, Express and vanilla HTML/CSS/JavaScript. It uses Zernio for TikTok account connection, media hosting and publishing.

## Requirements

- Node.js 20 or newer
- A Zernio account and API key with read/write access
- A Zernio profile and a TikTok account connected to that profile

## Run on Replit or locally

1. Extract the ZIP into your project.
2. Open the Shell and run `npm install`.
3. Run `npm start`.
4. Open the app preview.
5. Enter your Zernio API key on the ROUUPATCH login page and click **Login**.

You do **not** need to put `ZERNIO_API_KEY` or `ZERNIO_PROFILE_ID` in `.env`. After login, the server checks the key against `GET /v1/profiles` and automatically selects the Default profile (or the first profile returned). If your key cannot access a profile, use a full-access key or a key scoped to the intended profile.

Optional `.env` settings:

```env
APP_BASE_URL=https://your-replit-app.replit.app
PORT=3000
```

Set `APP_BASE_URL` to your deployed HTTPS URL so the TikTok OAuth callback returns to the correct app.

## Connect TikTok

1. Log in with your Zernio API key.
2. Click **Connect TikTok**.
3. Sign in to TikTok on Zernio's authorization page and approve the requested access.
4. Return to ROUUPATCH. Your connected account and creator-specific privacy settings should load.

## Publish

1. Select an MP4, MOV or WebM video.
2. Add a caption (up to 2,200 characters).
3. Choose a privacy option returned for the connected TikTok creator.
4. Set comments, Duet and Stitch if TikTok allows them.
5. Review the preview and check both consent confirmations.
6. Click **Publish to TikTok**.

The app uploads the original video to Zernio storage using a presigned upload URL, then submits the post through Zernio.

## Security notes

- The API key is sent to the Node.js server over the app connection and is kept in a server-side in-memory session. It is not written to localStorage, sessionStorage, frontend JavaScript, or `.env`.
- The session cookie is HttpOnly and SameSite=Lax. Sessions are held in memory and are cleared if the server restarts; users will need to log in again.
- Use HTTPS for any public deployment. Do not share API keys or commit them to source control.
- This simple session store is intended for a single Replit instance. For a multi-instance public service, use a proper shared session store, rate limiting, CSRF protection and an explicit privacy policy before inviting other users.

## Important limitations

- This project previews and uploads the original file. It does **not** re-encode or guarantee 1080p/60 FPS.
- TikTok publishing is subject to account permissions, platform restrictions, moderation and rate limits.
- Zernio may accept a publishing request before TikTok returns the final public post URL.

## References

- Zernio API keys: https://docs.zernio.com/api-keys/create-api-key
- Zernio profiles: https://docs.zernio.com/
- Connecting accounts: https://docs.zernio.com/guides/connecting-accounts
- TikTok platform: https://docs.zernio.com/platforms/tiktok
- Media uploads: https://docs.zernio.com/guides/media-uploads
