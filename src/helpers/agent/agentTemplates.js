// Starter configs for new agents (POST /workspaces/:workspaceId/agents { templateId }).
// Only behaviour lives here — links, demos and knowledge stay the author's job.
// Every config passes through normalizeGoal / normalizeQualification on create.

export const AGENT_TEMPLATES = [
  {
    id: 'meeting_booker',
    name: 'Meeting Booker',
    description: 'Answers questions, shows the product and steers every conversation to a booked call.',
    icon: 'calendar',
    highlights: ['Book a meeting', 'Balanced push', 'Calendar in the demo pane'],
    needs: ['bookMeetingUrl'],
    config: {
      welcomeMessage: 'Hey! Want a quick tour, or is there something specific you are trying to solve?',
      starterQuestions: ['Show me how it works', 'How does pricing work?', 'Can I talk to someone?'],
      goal: { flow: 'book_meeting', intensity: 'balanced' },
      qualification: {
        enabled: true,
        gateBooking: false,
        fields: [
          { label: 'Use case', question: 'What are you hoping to use it for?', type: 'text' },
          { label: 'Team size', question: 'How big is the team that would use it?', type: 'number' },
        ],
      },
    },
  },
  {
    id: 'lead_qualifier',
    name: 'Inbound Lead Qualifier',
    description: 'Qualifies visitors first. Qualified leads get your calendar, everyone else the trial.',
    icon: 'filter',
    highlights: ['Book a meeting', 'Qualification gate', 'Trial fallback'],
    needs: ['bookMeetingUrl', 'startTrialUrl'],
    config: {
      welcomeMessage: 'Hi! Tell me a bit about what you are working on and I will show you the most relevant part.',
      starterQuestions: ['Is this a fit for my team?', 'How does pricing work?', 'Show me the main workflow'],
      goal: { flow: 'book_meeting', intensity: 'balanced' },
      qualification: {
        enabled: true,
        gateBooking: true,
        fields: [
          { label: 'Team size', question: 'How many people are on the team?', type: 'number', rule: { op: 'gte', value: 10 } },
          { label: 'Timeline', question: 'When are you looking to get started?', type: 'select', options: ['This month', 'This quarter', 'Just exploring'], rule: { op: 'in', value: ['This month', 'This quarter'] } },
        ],
      },
    },
  },
  {
    id: 'aggressive_closer',
    name: 'Demo Closer',
    description: 'For high-intent traffic like pricing pages: offers a call early and opens the calendar on buying signals.',
    icon: 'thunderbolt',
    highlights: ['Book a meeting', 'Assertive push', 'Auto-opens calendar'],
    needs: ['bookMeetingUrl'],
    config: {
      welcomeMessage: 'Hey! Happy to answer anything about plans and pricing, or set up a call with the team.',
      starterQuestions: ['Which plan fits us?', 'Do you offer annual pricing?', 'Book a call'],
      goal: { flow: 'book_meeting', intensity: 'assertive' },
    },
  },
  {
    id: 'trial_starter',
    name: 'Self-Serve Trial',
    description: 'Shows the product and gets visitors to sign up and try it themselves.',
    icon: 'rocket',
    highlights: ['Start a trial', 'Balanced push'],
    needs: ['startTrialUrl'],
    config: {
      welcomeMessage: 'Hi! Want to see what you can do in the first five minutes?',
      starterQuestions: ['Show me the basics', 'Is there a free plan?', 'How long does setup take?'],
      goal: { flow: 'start_trial', intensity: 'balanced' },
    },
  },
  {
    id: 'product_guide',
    name: 'Product Guide',
    description: 'A helpful guide for docs and existing users. Never pushes a next step.',
    icon: 'read',
    highlights: ['Just answer', 'No sales push'],
    needs: [],
    config: {
      welcomeMessage: 'Hi! Ask me anything about the product and I will show you where it lives.',
      starterQuestions: ['How do I get started?', 'Show me the main features'],
      goal: { flow: 'educate', intensity: 'soft' },
    },
  },
]

export function findTemplate(id) {
  return AGENT_TEMPLATES.find(t => t.id === id) || null
}
