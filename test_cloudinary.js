import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function run() {
  try {
    const fileBuffer = `data:application/pdf;base64,JVBERi0xLjcKCjEgMCBvYmogICUKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmogICUKPDwKICAvVHlwZSAvUGFnZXMKICAvTWVkaWFCb3ggWyAwIDAgMjAwIDIwMCBdCiAgL0NvdW50IDEKICAvS2lkcyBbIDMgMCBSIF0KPj4KZW5kb2JqCgozIDAgb2JqICAlCjw8CiAgL1R5cGUgL1BhZ2UKICAvUGFyZW50IDIgMCBSCiAgL1Jlc291cmNlcyA8PAogICAgL0ZvbnQgPDwKICAgICAgL0YxIDQgMCBSCj4+Cj4+CiAgL0NvbnRlbnRzIDUgMCBSCj4+CmVuZG9iagoKNCAwIG9iaiAgJQo8PAogIC9UeXBlIC9Gb250CiAgL1N1YnR5cGUgL1R5cGUxCiAgL0Jhc2VGb250IC9UaW1lcy1Sb21hbgo+PgplbmRvYmoKCjUgMCBvYmogICUKPDwKICAvTGVuZ3RoIDIyCj4+CnN0cmVhbQpCVEQzOSBUZDAgVGwvdGVzdCBUMCBJZCBUalRFFGVuZHN0cmVhbQplbmRvYmoKCnhyZWYKMCA2Cj0wMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxMCAwMDAwMCBuIAowMDAwMDAwMDYwIDAwMDAwIG4gCjAwMDAwMDAxNDkgMDAwMDAgbiAKMDAwMDAwMDI1OCAwMDAwMCBuIAowMDAwMDAwMzUyIDAwMDAwIG4gCnRyYWlsZXIKPDwKICAvU2l6ZSA2CiAgL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjQwNgolJUVPRgo=`;
    
    // Auto (antiguo)
    try {
        const oldResult = await cloudinary.uploader.upload(fileBuffer, {
          folder: 'whatsapp_admin_media',
          resource_type: 'auto',
        });
        console.log("OLD UPLOAD (auto):", oldResult.secure_url);
    } catch(e) {
        console.log("OLD UPLOAD FAILED:", e.message);
    }

    // Raw (nuevo)
    const newResult = await cloudinary.uploader.upload(fileBuffer, {
      folder: 'whatsapp_admin_media',
      resource_type: 'raw',
      public_id: `doc_test_${Date.now()}.pdf`
    });
    console.log("NEW UPLOAD (raw):", newResult.secure_url);

    // Fetch url
    const fetchResult = await fetch(newResult.secure_url);
    console.log("FETCH RESULT STATUS:", fetchResult.status);
    
  } catch (error) {
    console.error('Test error:', error);
  }
}

run();
