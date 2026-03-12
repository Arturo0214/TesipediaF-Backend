import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function run() {
  const fileBuffer = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=`;
  const newResult = await cloudinary.uploader.upload(fileBuffer, {
    folder: 'whatsapp_admin_media',
    resource_type: 'image',
  });
  console.log("IMG URL:", newResult.secure_url);
  const fetchResult = await fetch(newResult.secure_url);
  console.log("FETCH RESULT STATUS:", fetchResult.status);
}
run();
