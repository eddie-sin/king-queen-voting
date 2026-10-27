import "./privacy-page.css";
export default function PrivacyPage() {
  return (
    <section className="privacy-page">
      <div className="source-heading">
        <h1>
          Your <em>privacy.</em>
        </h1>
        <p>GUSTO Thadingyut Festival · Updated October 26, 2026</p>
      </div>
      <div className="privacy-copy">
        <h2>Accounts and sign-in</h2>
        <p>
          We use your Gmail address to maintain one festival account and send
          verification or recovery codes through Resend. If you use Google
          sign-in, we verify your Google account identifier and email. We do not
          request access to your inbox, Contacts, or Drive. Passwords are stored
          as secure hashes. Essential cookies keep you signed in; signing out
          ends that browser session.
        </p>
        <h2>Festival activity</h2>
        <p>
          Votes are linked to your account to enforce voting limits. Individual
          choices are not publicly listed; candidate totals are shown when
          organisers open announcements. Wishes are public. Approved Memory
          Photos and their images appear in the public gallery. Pending and
          rejected images are available to authorised staff for moderation.
          You can check your submission status and allowance in My Memories.
          Moderation decisions, likes and submission limits are linked to accounts.
        </p>
        <h2>Service providers and retention</h2>
        <p>
          The application uses Google for sign-in, Resend for transactional
          emails, and MongoDB Atlas and AWS for application data and images.
          Expired sign-in challenges and sessions are removed automatically.
          Festival accounts and content are kept until the organisers remove
          them. Contact us to request deletion of your account or content.
        </p>
        <h2>Contact and access</h2>
        <p>
          For account or deletion questions, contact the event organisers at{" "}
          <a href="mailto:thantsinaungeddie@gmail.com">thantsinaungeddie@gmail.com</a>.
          Account verification does not prove attendance at the physical event.
        </p>
        <p>
          <a href="#home">Back to the festival</a>
        </p>
      </div>
    </section>
  );
}
