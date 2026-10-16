/**
 * Demo / Mock Data — Clearly identifiable placeholders.
 * Replace with real backend data when available.
 */

export const DEMO_JOBS = [
  {
    id: '1',
    title: 'Full Stack Developer',
    company: 'Northstar Labs',
    companyMark: 'N',
    location: 'Bengaluru, India',
    type: 'Full Time',
    experienceMin: 0,
    experienceMax: 2,
    experienceLabel: '0–2 years',
    postedDaysAgo: 2,
    description: 'We are looking for a motivated Full Stack Engineer to join our core platform team. You will build scalable backend services and responsive frontend interfaces.',
    responsibilities: [
      'Design and develop full-stack features using React, Node.js, and Java',
      'Write clean, testable, well-documented code',
      'Participate in code reviews and technical discussions',
      'Collaborate with cross-functional teams to deliver features',
    ],
    qualifications: [
      'B.Tech/B.E. in Computer Science or related field',
      'Strong fundamentals in data structures and web technology',
      'Familiarity with RESTful API design and React',
    ],
    requiredSkills: ['React', 'Node.js', 'Java', 'SQL', 'Git'],
    preferredSkills: ['TypeScript', 'Docker', 'AWS'],
    skills: ['React', 'Node.js', 'Java', 'SQL'],
  },
  {
    id: '2',
    title: 'Frontend Developer',
    company: 'PixelCraft Studio',
    companyMark: 'P',
    location: 'Hyderabad, India',
    type: 'Full Time',
    experienceMin: 1,
    experienceMax: 3,
    experienceLabel: '1–3 years',
    postedDaysAgo: 5,
    description: 'Join our design-forward engineering team to build beautiful, performant web applications.',
    responsibilities: [
      'Build responsive, accessible UI components with React',
      'Collaborate with designers to implement pixel-perfect interfaces',
      'Optimize web application performance',
    ],
    qualifications: [
      'B.Tech/B.E. in Computer Science or equivalent',
      'Strong JavaScript/TypeScript fundamentals',
    ],
    requiredSkills: ['React', 'JavaScript', 'TypeScript', 'CSS', 'HTML'],
    preferredSkills: ['Next.js', 'Tailwind CSS', 'Figma'],
    skills: ['React', 'JavaScript', 'TypeScript', 'CSS'],
  },
  {
    id: '3',
    title: 'Backend Engineer',
    company: 'CloudSync Technologies',
    companyMark: 'C',
    location: 'Pune, India',
    type: 'Full Time',
    experienceMin: 0,
    experienceMax: 2,
    experienceLabel: '0–2 years',
    postedDaysAgo: 3,
    description: 'Build cloud-native microservices powering our device synchronization platform.',
    responsibilities: [
      'Develop high-throughput microservices in Java and Spring Boot',
      'Design and implement REST APIs',
      'Work with containerized deployments on Kubernetes',
    ],
    qualifications: [
      'B.Tech/B.E. in Computer Science or equivalent',
      'Strong programming skills in Java',
    ],
    requiredSkills: ['Java', 'Spring Boot', 'Docker', 'Kubernetes', 'SQL'],
    preferredSkills: ['Go', 'gRPC', 'Kafka'],
    skills: ['Java', 'Spring Boot', 'Docker', 'K8s'],
  },
  {
    id: '4',
    title: 'ML Engineer Intern',
    company: 'Athena AI',
    companyMark: 'A',
    location: 'Bengaluru, India',
    type: 'Internship',
    experienceMin: 0,
    experienceMax: 1,
    experienceLabel: '0–1 years',
    postedDaysAgo: 4,
    description: 'Work on production ML systems powering conversational AI products.',
    responsibilities: [
      'Train and evaluate machine learning models',
      'Process and clean datasets',
      'Deploy models to production',
    ],
    qualifications: [
      'B.Tech/M.Tech in CS/AI/ML',
      'Python proficiency and ML foundation',
    ],
    requiredSkills: ['Python', 'PyTorch', 'Machine Learning', 'NumPy'],
    preferredSkills: ['Transformers', 'MLOps', 'Docker'],
    skills: ['Python', 'PyTorch', 'ML', 'NumPy'],
  },
];

export const DEMO_APPLICATIONS = [];

export const DEMO_STATS = {
  applications: 0,
  matchedJobs: DEMO_JOBS.length,
  outreach: 0,
  responses: 0,
  interviews: 0,
};

export const DEFAULT_PROFILE = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  skills: [],
  education: [],
  experience: [],
  projects: [],
  links: { github: '', linkedin: '', portfolio: '', other: '' },
  preferences: { roles: [], locations: [], jobTypes: [], minExperience: 0 },
  yearsOfExperience: 0,
};
