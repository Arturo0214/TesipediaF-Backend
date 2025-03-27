import mongoose from 'mongoose';

const visitSchema = new mongoose.Schema(
  {
    ip: String,
    userAgent: String,
    path: String,
    cookieId: String,
    city: String,
    region: String,
    country: String,
    org: String,
    location: String, // lat,lng
  },
  { timestamps: true }
);

const Visit = mongoose.model('Visit', visitSchema);
export default Visit;