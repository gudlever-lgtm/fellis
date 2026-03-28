import pool from './db.js'

// Removes all jobs data: applications, saves, shared jobs, and the jobs themselves.
// Pass --with-companies to also remove all companies and their posts/follows/members.

const withCompanies = process.argv.includes('--with-companies')

async function cleanupJobs() {
  const conn = await pool.getConnection()
  try {
    // Job applications
    const [delApps] = await conn.query('DELETE FROM job_applications').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delApps.affectedRows} job applications`)

    // Job saves (bookmarks)
    const [delSaves] = await conn.query('DELETE FROM job_saves').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delSaves.affectedRows} job saves`)

    // Shared jobs
    const [delShared] = await conn.query('DELETE FROM shared_jobs').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delShared.affectedRows} shared jobs`)

    // Jobs themselves
    const [delJobs] = await conn.query('DELETE FROM jobs').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delJobs.affectedRows} jobs`)
    await conn.query('ALTER TABLE jobs AUTO_INCREMENT = 1').catch(() => {})

    if (withCompanies) {
      // Company leads
      const [delLeads] = await conn.query('DELETE FROM company_leads').catch(() => [{ affectedRows: 0 }])
      console.log(`Removed ${delLeads.affectedRows} company leads`)

      // Company post comments and likes
      const [delCpComments] = await conn.query('DELETE FROM company_post_comments').catch(() => [{ affectedRows: 0 }])
      console.log(`Removed ${delCpComments.affectedRows} company post comments`)
      const [delCpLikes] = await conn.query('DELETE FROM company_post_likes').catch(() => [{ affectedRows: 0 }])
      console.log(`Removed ${delCpLikes.affectedRows} company post likes`)

      // Company posts
      const [delCposts] = await conn.query('DELETE FROM company_posts').catch(() => [{ affectedRows: 0 }])
      console.log(`Removed ${delCposts.affectedRows} company posts`)

      // Company follows and members
      await conn.query('DELETE FROM company_follows').catch(() => {})
      await conn.query('DELETE FROM company_members').catch(() => {})

      // Companies
      const [delCompanies] = await conn.query('DELETE FROM companies').catch(() => [{ affectedRows: 0 }])
      console.log(`Removed ${delCompanies.affectedRows} companies`)
      await conn.query('ALTER TABLE companies AUTO_INCREMENT = 1').catch(() => {})
    } else {
      console.log('(Skipping companies — pass --with-companies to also remove companies)')
    }

    console.log('\n✅ All jobs data cleaned up!')

  } finally {
    conn.release()
    await pool.end()
  }
}

cleanupJobs().catch(err => { console.error('Cleanup failed:', err); process.exit(1) })
