import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  connectMongo,
  CandidateModel,
  CampaignModel,
  ConnectionModel,
  JobModel,
  BroadcastModel,
} from '../lib/mongodb.js';

async function migrate() {
  console.log('🚀 Starting Data Migration to MongoDB Atlas...');
  const connected = await connectMongo();
  if (!connected) {
    console.error('❌ Failed to connect to MongoDB Atlas. Check your MONGODB_URI.');
    process.exit(1);
  }

  const dataDir = join(process.cwd(), 'data');

  // 1. Candidates
  const candFile = join(dataDir, 'candidates.json');
  if (existsSync(candFile)) {
    try {
      const candidates = JSON.parse(readFileSync(candFile, 'utf-8') || '[]');
      let count = 0;
      for (const c of candidates) {
        if (!c.email) continue;
        await CandidateModel.findOneAndUpdate(
          { email: c.email.toLowerCase().trim() },
          { $set: c },
          { upsert: true, returnDocument: 'after' }
        );
        count++;
      }
      console.log(`✅ Migrated ${count} candidates to MongoDB Atlas.`);
    } catch (err) {
      console.error('⚠️ Candidates migration error:', err.message);
    }
  }

  // 2. Campaigns
  const campFile = join(dataDir, 'campaigns.json');
  if (existsSync(campFile)) {
    try {
      const data = JSON.parse(readFileSync(campFile, 'utf-8') || '{}');
      const campaigns = Array.isArray(data.campaigns) ? data.campaigns : (Array.isArray(data) ? data : []);
      let count = 0;
      for (const camp of campaigns) {
        if (!camp.id) continue;
        await CampaignModel.findOneAndUpdate(
          { id: camp.id },
          { $set: camp },
          { upsert: true, returnDocument: 'after' }
        );
        count++;
      }
      console.log(`✅ Migrated ${count} campaigns to MongoDB Atlas.`);
    } catch (err) {
      console.error('⚠️ Campaigns migration error:', err.message);
    }
  }

  // 3. Connections
  const connFile = join(dataDir, 'connections.json');
  if (existsSync(connFile)) {
    try {
      const connections = JSON.parse(readFileSync(connFile, 'utf-8') || '[]');
      let count = 0;
      for (const conn of connections) {
        if (!conn.name) continue;
        const filter = conn.profileUrl ? { profileUrl: conn.profileUrl } : { name: conn.name };
        await ConnectionModel.findOneAndUpdate(
          filter,
          { $set: conn },
          { upsert: true, returnDocument: 'after' }
        );
        count++;
      }
      console.log(`✅ Migrated ${count} connections to MongoDB Atlas.`);
    } catch (err) {
      console.error('⚠️ Connections migration error:', err.message);
    }
  }

  // 4. Jobs
  const jobFile = join(dataDir, 'jobs.json');
  if (existsSync(jobFile)) {
    try {
      const jobs = JSON.parse(readFileSync(jobFile, 'utf-8') || '[]');
      let count = 0;
      for (const job of jobs) {
        if (!job.id) continue;
        await JobModel.findOneAndUpdate(
          { id: job.id },
          { $set: job },
          { upsert: true, returnDocument: 'after' }
        );
        count++;
      }
      console.log(`✅ Migrated ${count} jobs to MongoDB Atlas.`);
    } catch (err) {
      console.error('⚠️ Jobs migration error:', err.message);
    }
  }

  // 5. Broadcasts
  const bcastFile = join(dataDir, 'sent_broadcasts.json');
  if (existsSync(bcastFile)) {
    try {
      const broadcasts = JSON.parse(readFileSync(bcastFile, 'utf-8') || '[]');
      let count = 0;
      for (const b of broadcasts) {
        if (!b.id) continue;
        await BroadcastModel.findOneAndUpdate(
          { id: b.id },
          { $set: b },
          { upsert: true, returnDocument: 'after' }
        );
        count++;
      }
      console.log(`✅ Migrated ${count} broadcasts to MongoDB Atlas.`);
    } catch (err) {
      console.error('⚠️ Broadcasts migration error:', err.message);
    }
  }

  console.log('🎉 Full Migration to MongoDB Atlas Completed Successfully!');
  process.exit(0);
}

migrate();
