export const canLanternReset = staff => staff?.role === 'admin' || staff?.permissions?.includes('lantern.votes.reset');
export const canAnnounceLantern = ({ controls, winner }) => Boolean(controls && !controls.lanternVotingOpen && !controls.lanternAnnouncementOpen && winner);
