#!/usr/bin/env node
/**
 * Food Image Downloader
 *
 * Downloads real product/food photos for each item in foods.json.
 * Sources (tried in order):
 *   1. Open Food Facts API — searches by product name + brand
 *   2. Google Custom Search (if API key provided)
 *   3. Unsplash (if API key provided)
 *
 * Usage:
 *   node download-images.js                          # Run with Open Food Facts only
 *   GOOGLE_API_KEY=xxx GOOGLE_CX=yyy node download-images.js   # + Google Images
 *   UNSPLASH_KEY=xxx node download-images.js         # + Unsplash fallback
 *
 * Options:
 *   --skip-existing    Skip foods that already have a .jpg image (default)
 *   --force            Re-download all images
 *   --start=ID         Start from a specific food ID
 *   --only=ID          Download only a specific food
 *   --dry-run          Show what would be downloaded without downloading
 *   --delay=MS         Delay between API calls in ms (default: 500)
 *
 * Output:
 *   images/{food_id}.jpg  — 250x250 JPEG product photo
 *   download-log.json     — tracks download status for each food
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ── Config ──────────────────────────────────────────────────────────────
const IMAGES_DIR = path.join(__dirname, 'images');
const FOODS_FILE = path.join(__dirname, 'foods.json');
const LOG_FILE = path.join(__dirname, 'download-log.json');
const TARGET_SIZE = 250;
const JPEG_QUALITY = 85;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const SKIP_EXISTING = !FORCE;
const DELAY = parseInt((args.find(a => a.startsWith('--delay=')) || '').split('=')[1]) || 500;
const START_ID = (args.find(a => a.startsWith('--start=')) || '').split('=')[1] || null;
const ONLY_ID = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || null;
const GOOGLE_CX = process.env.GOOGLE_CX || null;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY || null;

// ── Helpers ─────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, { headers: { 'User-Agent': 'FoodImageDownloader/1.0' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJSON(res.headers.location).then(resolve, reject);
            }
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON from ' + url)); }
            });
        }).on('error', reject);
    });
}

function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { headers: { 'User-Agent': 'FoodImageDownloader/1.0' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadImage(res.headers.location).then(resolve, reject);
            }
            if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

// ── Resize with canvas (requires 'canvas' or 'sharp') ──────────────────
let resizeImage;
try {
    const sharp = require('sharp');
    resizeImage = async (buffer, size) => {
        return sharp(buffer)
            .resize(size, size, { fit: 'cover', position: 'centre' })
            .jpeg({ quality: JPEG_QUALITY })
            .toBuffer();
    };
    console.log('✓ Using sharp for image processing');
} catch (_) {
    // Fallback: save raw (user can batch-resize later)
    resizeImage = async (buffer) => buffer;
    console.log('⚠ sharp not installed — images will be saved at original size');
    console.log('  Install with: npm install sharp');
}

// ── Source 1: Open Food Facts ───────────────────────────────────────────
async function searchOpenFoodFacts(name, brand) {
    const searchTerms = brand ? `${name} ${brand}` : name;
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(searchTerms)}&json=1&page_size=5&fields=product_name,brands,image_front_url,image_front_small_url,image_url`;
    try {
        const data = await fetchJSON(url);
        if (!data.products || data.products.length === 0) return null;
        // Find best match — prefer one with an image
        for (const p of data.products) {
            const imgUrl = p.image_front_url || p.image_front_small_url || p.image_url;
            if (imgUrl) return imgUrl;
        }
        return null;
    } catch (e) {
        console.log(`    OFF error: ${e.message}`);
        return null;
    }
}

// ── Source 2: Google Custom Search ──────────────────────────────────────
async function searchGoogleImages(query) {
    if (!GOOGLE_API_KEY || !GOOGLE_CX) return null;
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query + ' food product')}&searchType=image&num=1&imgSize=medium&safe=active`;
    try {
        const data = await fetchJSON(url);
        if (data.items && data.items[0]?.link) return data.items[0].link;
        return null;
    } catch (e) {
        console.log(`    Google error: ${e.message}`);
        return null;
    }
}

// ── Source 3: Unsplash ─────────────────────────────────────────────────
async function searchUnsplash(query) {
    if (!UNSPLASH_KEY) return null;
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&client_id=${UNSPLASH_KEY}`;
    try {
        const data = await fetchJSON(url);
        if (data.results && data.results[0]?.urls?.small) return data.results[0].urls.small;
        return null;
    } catch (e) {
        console.log(`    Unsplash error: ${e.message}`);
        return null;
    }
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

    const foods = JSON.parse(fs.readFileSync(FOODS_FILE, 'utf8'));
    const log = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) : {};

    console.log(`\n📦 ${foods.length} foods in database`);
    console.log(`📁 Images directory: ${IMAGES_DIR}`);
    console.log(`🔧 Sources: Open Food Facts${GOOGLE_API_KEY ? ' + Google Images' : ''}${UNSPLASH_KEY ? ' + Unsplash' : ''}`);
    if (!GOOGLE_API_KEY) console.log('   💡 Set GOOGLE_API_KEY + GOOGLE_CX for Google Image Search fallback');
    if (!UNSPLASH_KEY) console.log('   💡 Set UNSPLASH_KEY for Unsplash fallback');
    console.log('');

    let started = !START_ID;
    let downloaded = 0, skipped = 0, failed = 0;

    for (let i = 0; i < foods.length; i++) {
        const food = foods[i];
        const id = food.id;

        if (ONLY_ID && id !== ONLY_ID) continue;
        if (!started) {
            if (id === START_ID) started = true;
            else continue;
        }

        const imgPath = path.join(IMAGES_DIR, `${id}.jpg`);
        const progress = `[${i + 1}/${foods.length}]`;

        // Skip if already exists
        if (SKIP_EXISTING && fs.existsSync(imgPath)) {
            skipped++;
            continue;
        }

        const displayName = food.brand ? `${food.name} (${food.brand})` : food.name;
        console.log(`${progress} ${displayName}`);

        if (DRY_RUN) {
            console.log(`    → Would search and download`);
            continue;
        }

        let imageUrl = null;
        let source = null;

        // Try Open Food Facts
        imageUrl = await searchOpenFoodFacts(food.name, food.brand);
        if (imageUrl) source = 'openfoodfacts';

        // Try Google Images
        if (!imageUrl) {
            await sleep(200);
            const query = food.brand ? `${food.name} ${food.brand}` : food.name;
            imageUrl = await searchGoogleImages(query);
            if (imageUrl) source = 'google';
        }

        // Try Unsplash (good for generic foods like "chicken breast")
        if (!imageUrl) {
            await sleep(200);
            imageUrl = await searchUnsplash(food.name);
            if (imageUrl) source = 'unsplash';
        }

        if (!imageUrl) {
            console.log(`    ✗ No image found`);
            log[id] = { status: 'not_found', timestamp: new Date().toISOString() };
            failed++;
            await sleep(DELAY);
            continue;
        }

        // Download the image
        try {
            console.log(`    ↓ ${source}: ${imageUrl.substring(0, 80)}...`);
            const buffer = await downloadImage(imageUrl);

            // Resize and save as JPEG
            const resized = await resizeImage(buffer, TARGET_SIZE);
            fs.writeFileSync(imgPath, resized);

            log[id] = { status: 'ok', source, url: imageUrl, timestamp: new Date().toISOString() };
            downloaded++;
            console.log(`    ✓ Saved (${Math.round(resized.length / 1024)} KB)`);
        } catch (e) {
            console.log(`    ✗ Download failed: ${e.message}`);
            log[id] = { status: 'error', source, url: imageUrl, error: e.message, timestamp: new Date().toISOString() };
            failed++;
        }

        // Save log periodically
        if ((downloaded + failed) % 10 === 0) {
            fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
        }

        await sleep(DELAY);
    }

    // Final save
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));

    console.log(`\n── Done ──`);
    console.log(`  Downloaded: ${downloaded}`);
    console.log(`  Skipped:    ${skipped}`);
    console.log(`  Failed:     ${failed}`);
    console.log(`  Log:        ${LOG_FILE}`);

    // Remove old SVGs if images were downloaded
    if (downloaded > 0) {
        const svgs = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith('.svg'));
        if (svgs.length > 0) {
            console.log(`\n  Found ${svgs.length} old .svg files.`);
            console.log(`  Run this to remove them:`);
            console.log(`    cd images && rm *.svg`);
        }
    }
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
