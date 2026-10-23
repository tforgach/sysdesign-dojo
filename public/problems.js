// difficulty: 1 = white-belt warmup, 2 = standard interview, 3 = hard / senior+
window.PROBLEMS = [
  // Storage & files
  { title: 'Dropbox', cat: 'Storage', diff: 2, prompt: 'Design a cloud file storage and sync service like Dropbox. Users upload, download, and share files, and changes sync across their devices. Files can be very large.' },
  { title: 'Pastebin', cat: 'Storage', diff: 1, prompt: 'Design a service like Pastebin. Users paste text and get a shareable link. Pastes can expire, and some are private.' },
  { title: 'Bit.ly URL Shortener', cat: 'Storage', diff: 1, prompt: 'Design a URL shortening service like Bit.ly. Users submit long URLs and get short links that redirect to the original. Links can optionally expire or use custom aliases.' },
  { title: 'Distributed Key-Value Store', cat: 'Infra', diff: 3, prompt: 'Design a distributed key-value store like DynamoDB. It must scale horizontally, stay available through node failures, and offer tunable consistency.' },
  { title: 'Google Docs (Collaborative Editing)', cat: 'Realtime', diff: 3, prompt: 'Design a collaborative document editor like Google Docs. Multiple users edit the same document at once and see each other\'s changes in real time, including offline edits that sync later.' },

  // Social & feeds
  { title: 'Twitter News Feed', cat: 'Social', diff: 2, prompt: 'Design the home timeline for a social network like Twitter/X. Users post short messages, follow others, and see a feed of posts from the people they follow. Some accounts have tens of millions of followers.' },
  { title: 'Instagram', cat: 'Social', diff: 2, prompt: 'Design a photo sharing app like Instagram. Users upload photos, follow others, like and comment, and browse a feed of recent photos.' },
  { title: 'Trending Topics / Top-K', cat: 'Social', diff: 2, prompt: 'Design a system that shows the top trending hashtags over the last hour for a social network handling hundreds of thousands of posts per second.' },
  { title: 'News Aggregator (Reddit-style)', cat: 'Social', diff: 1, prompt: 'Design a link-sharing site like Reddit. Users post links to communities, comment, and upvote. Posts are ranked by a mix of votes and recency.' },

  // Messaging & realtime
  { title: 'WhatsApp', cat: 'Realtime', diff: 2, prompt: 'Design a real-time messaging service like WhatsApp. Users send 1:1 and group messages, including to offline recipients, and see delivery status.' },
  { title: 'Slack', cat: 'Realtime', diff: 2, prompt: 'Design a workplace chat product like Slack with workspaces, channels, threads, search and presence indicators.' },
  { title: 'Zoom / Video Conferencing', cat: 'Realtime', diff: 3, prompt: 'Design a video conferencing service like Zoom. Meetings host from 2 to 1,000 participants with low latency audio and video, screen share, and optional recording.' },
  { title: 'Notification Service', cat: 'Infra', diff: 2, prompt: 'Design a notification system that sends push, SMS and email notifications to millions of users on behalf of many internal teams, with user preferences, retries and rate limits.' },
  { title: 'Real-Time Leaderboard', cat: 'Realtime', diff: 1, prompt: 'Design a real-time global leaderboard for a game with 100M players. Show the top N players and any player\'s current rank, with scores updating constantly.' },

  // Marketplaces & booking
  { title: 'Ticketmaster', cat: 'Marketplace', diff: 2, prompt: 'Design the ticket buying system for a service like Ticketmaster. Users browse events, view seat availability, and purchase tickets. Popular events (think Taylor Swift) cause massive spikes of traffic.' },
  { title: 'Airbnb / Hotel Booking', cat: 'Marketplace', diff: 2, prompt: 'Design a lodging booking platform like Airbnb. Guests search listings by location and dates, and book stays without ever being double-booked.' },
  { title: 'Online Auction (eBay)', cat: 'Marketplace', diff: 2, prompt: 'Design an online auction site like eBay. Sellers list items, buyers place bids, and the highest bid when the auction ends wins. Bids on hot items arrive concurrently.' },
  { title: 'Uber', cat: 'Marketplace', diff: 3, prompt: 'Design a ride-hailing service like Uber. Riders request a ride from a pickup to a destination, get a fare estimate, and are matched with a nearby driver.' },
  { title: 'DoorDash / Food Delivery', cat: 'Marketplace', diff: 3, prompt: 'Design a food delivery platform like DoorDash. Customers order from restaurants, couriers are assigned, and everyone sees live order status and ETA.' },
  { title: 'Payment System (Stripe)', cat: 'Marketplace', diff: 3, prompt: 'Design a payment processing system like Stripe. Merchants charge customers, money must never be lost or double-charged, and every transaction must be auditable.' },
  { title: 'Stock Trading (Robinhood)', cat: 'Marketplace', diff: 3, prompt: 'Design a retail stock trading app like Robinhood. Users see live quotes, place orders, and view their portfolio, with huge load at market open.' },

  // Media & search
  { title: 'YouTube / Netflix', cat: 'Media', diff: 2, prompt: 'Design a video sharing platform like YouTube. Users upload videos and others stream them on a wide variety of devices and network conditions.' },
  { title: 'Spotify', cat: 'Media', diff: 2, prompt: 'Design a music streaming service like Spotify with playlists, search, offline downloads and recommendations.' },
  { title: 'Yelp / Nearby Places', cat: 'Search', diff: 2, prompt: 'Design a business search and review service like Yelp. Users search for businesses by name, category, and location, view details, and leave reviews and ratings.' },
  { title: 'Typeahead / Autocomplete', cat: 'Search', diff: 2, prompt: 'Design a search autocomplete system that suggests the top queries as the user types, with sub-100ms latency for a search engine with billions of queries a day.' },
  { title: 'Web Crawler', cat: 'Search', diff: 2, prompt: 'Design a web crawler that downloads and stores the content of billions of pages for a search engine, politely and without re-crawling duplicates excessively.' },
  { title: 'Google Maps Navigation', cat: 'Search', diff: 3, prompt: 'Design a maps and turn-by-turn navigation service like Google Maps with live traffic-aware routing and ETAs.' },
  { title: 'LeetCode (Online Judge)', cat: 'Infra', diff: 2, prompt: 'Design an online coding judge like LeetCode. Users submit code in many languages, which is run safely against test cases, and a live leaderboard is shown during contests.' },

  // Infra
  { title: 'Distributed Rate Limiter', cat: 'Infra', diff: 2, prompt: 'Design a rate limiter that protects an API fleet. It must enforce per-user, per-IP, and per-endpoint limits across many servers with very low added latency.' },
  { title: 'Distributed Message Queue (Kafka)', cat: 'Infra', diff: 3, prompt: 'Design a distributed message queue like Kafka or SQS. Producers publish messages, consumer groups read them with at-least-once delivery, and ordering matters within a partition.' },
  { title: 'Job Scheduler', cat: 'Infra', diff: 3, prompt: 'Design a distributed job scheduler that runs millions of one-off and recurring jobs (cron-style) reliably, exactly once as far as possible, and at the right time.' },
  { title: 'Metrics & Monitoring (Datadog)', cat: 'Infra', diff: 3, prompt: 'Design a metrics monitoring and alerting system like Datadog. Thousands of services emit metrics every few seconds, and users query dashboards and get alerts when thresholds are crossed.' },
  { title: 'Ad Click Aggregator', cat: 'Infra', diff: 3, prompt: 'Design a system that ingests ad click events at huge scale and lets advertisers query click counts by ad, minute, and campaign with accurate, near-real-time results.' },
  { title: 'Distributed Cache', cat: 'Infra', diff: 3, prompt: 'Design a distributed caching layer like Memcached/Redis Cluster that many services rely on. Address eviction, hot keys, and node failures.' },
];

// The six Hello Interview steps ("kata").
window.STAGES = [
  { id: 'functional', name: 'Functional Requirements', num: 'I', minutes: 3, board: false, probes: false,
    goal: 'Clarify scope. State the top 3-4 "Users should be able to…" capabilities and what is explicitly out of scope.',
    tips: ['Ask clarifying questions out loud', 'Prioritize: what is core vs. below the line?', 'Keep it to ~3-4 requirements'] },
  { id: 'nonfunctional', name: 'Non-Functional Requirements', num: 'II', minutes: 3, board: false, probes: false,
    goal: 'Name the system qualities that matter for THIS problem, with numbers and tradeoffs.',
    tips: ['Availability vs. consistency: which one wins here and why?', 'Latency targets, scale (DAU, QPS, storage)', 'Durability, security, fault tolerance — only if relevant'] },
  { id: 'entities', name: 'Core Entities', num: 'III', minutes: 2, board: false, probes: false,
    goal: 'List the main nouns of the system and their key fields/relationships. Stay high level.',
    tips: ['Just the entities, not a full schema', 'Mention important relationships', 'You can refine later'] },
  { id: 'api', name: 'API / Interface', num: 'IV', minutes: 5, board: false, probes: false,
    goal: 'Define the endpoints that satisfy each functional requirement, in order.',
    tips: ['Verb + path + key params + response', 'User identity comes from the auth token, not the body', 'Pagination, idempotency where relevant'] },
  { id: 'hld', name: 'High-Level Design', num: 'V', minutes: 10, board: true, probes: true,
    goal: 'Draw the architecture and walk through it, one functional requirement at a time. Narrate while you draw.',
    tips: ['Client → gateway → services → data stores', 'Justify each datastore choice', 'Walk each API through the diagram', 'Do not optimize yet'] },
  { id: 'deepdives', name: 'Deep Dives', num: 'VI', minutes: 10, board: true, probes: true,
    goal: 'Harden the design against the non-functional requirements. Pick the real bottlenecks and weigh alternatives.',
    tips: ['Scaling hot paths, caching, sharding', 'Concurrency and consistency issues', 'Failure modes and how you recover', 'Drive: propose the dives yourself'] },
];

// Belts awarded by overall score.
window.BELTS = [
  { min: 0,  name: 'White Belt',  color: '#f2ede0' },
  { min: 20, name: 'Yellow Belt', color: '#e8c547' },
  { min: 35, name: 'Orange Belt', color: '#e08a2c' },
  { min: 50, name: 'Green Belt',  color: '#4f9a54' },
  { min: 62, name: 'Blue Belt',   color: '#3f72b8' },
  { min: 74, name: 'Brown Belt',  color: '#8a5230' },
  { min: 86, name: 'Black Belt',  color: '#0d0d0d' },
];
