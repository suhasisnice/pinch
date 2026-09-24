/**
 * What the categoriser knows before the user has taught it anything: the
 * categories and their sub-categories, the brands a student in India actually
 * pays, and the generic words that give a shop away.
 *
 * Plain data, no logic. See src/math/categoriser.ts for how it is matched —
 * always on whole words, never on a substring, which is exactly what used to
 * make "ola" catch Motorola and "jio" catch JioMart.
 */

/**
 * Top-level spend categories, in picker order. `null` on a transaction means
 * "not yet categorised". `Cash` is deliberately absent: it is set by the
 * non-spend classifier for an ATM withdrawal, never picked.
 */
export const CATEGORIES = [
  'Food',
  'Groceries',
  'Transport',
  'Travel',
  'Shopping',
  'Personal care',
  'Subscriptions',
  'Outing',
  'Academics',
  'Health',
  'Bills',
  'Rent',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * The second level. Shown only where it helps: on a row ("Food · Delivery"),
 * one tap deeper in the picker, and as a breakdown once a category is opened.
 * Charts and Today stay top-level.
 */
export const SUBCATEGORIES: Readonly<Record<Category, readonly string[]>> = {
  Food: ['Delivery', 'Dining out', 'Cafés & chai', 'Canteen & mess', 'Snacks & sweets'],
  Groceries: ['Quick delivery', 'Supermarket', 'Kirana', 'Fruit, veg & dairy'],
  Transport: ['Cabs & autos', 'Metro & bus', 'Fuel', 'Parking & tolls', 'Bike rental'],
  Travel: ['Trains', 'Flights', 'Buses', 'Stays'],
  Shopping: ['Online', 'Clothes & shoes', 'Electronics', 'Home & essentials', 'Gifts'],
  'Personal care': ['Salon & grooming', 'Gym & fitness', 'Beauty', 'Laundry'],
  Subscriptions: ['Streaming', 'Music', 'Apps & cloud', 'Memberships'],
  Outing: ['Movies', 'Bars & pubs', 'Events', 'Games & activities'],
  Academics: ['Fees', 'Books & stationery', 'Print & xerox', 'Courses', 'Exams'],
  Health: ['Pharmacy', 'Doctor & clinic', 'Tests & labs'],
  Bills: ['Mobile recharge', 'Electricity', 'Internet', 'Water & gas', 'Maintenance'],
  Rent: ['PG & hostel', 'Rent', 'Deposit'],
  Other: [],
};

export function isCategory(value: string | null | undefined): value is Category {
  return value != null && (CATEGORIES as readonly string[]).includes(value);
}

/** A sub-category only counts if it belongs to the category it is filed under. */
export function isSubcategoryOf(category: string | null, sub: string | null): boolean {
  if (!category || !sub || !isCategory(category)) return false;
  return SUBCATEGORIES[category].includes(sub);
}

/** One brand the app knows by name. */
export interface Brand {
  /** Every way it is written, lowercase. Multi-word names match as a phrase. */
  names: readonly string[];
  category: Category;
  sub: string | null;
  /**
   * The name is genuinely ambiguous ("apollo" is a pharmacy and a tyre
   * company), so a match is offered as a guess, never applied as certain.
   */
  guess?: boolean;
}

const b = (names: string | string[], category: Category, sub: string | null, guess = false): Brand => ({
  names: Array.isArray(names) ? names : [names],
  category,
  sub,
  guess,
});

/**
 * Brands, curated for an Indian college student's statement. Where one
 * parent owns several businesses (Swiggy / Instamart, Zomato / Blinkit,
 * Amazon / Prime / Fresh), each is listed on its own and the longest name
 * that matches wins, so "Swiggy Instamart" is groceries rather than food.
 */
export const BRANDS: readonly Brand[] = [
  // Food — delivery
  b(['swiggy', 'bundl technologies'], 'Food', 'Delivery'),
  b(['zomato', 'eternal ltd'], 'Food', 'Delivery'),
  b(['eatsure', 'box8', 'faasos', 'behrouz', 'eatfit', 'freshmenu', 'rebel foods'], 'Food', 'Delivery'),
  b(['magicpin'], 'Food', 'Delivery', true),
  // Food — dining out
  b(['dominos', 'domino s', 'jubilant foodworks'], 'Food', 'Dining out'),
  b(['mcdonald', 'mcdonalds', 'mc donalds', 'hardcastle', 'westlife'], 'Food', 'Dining out'),
  b(['kfc', 'burger king', 'burgerking', 'pizza hut', 'pizzahut', 'subway', 'taco bell', 'wow momo', 'wowmomo'], 'Food', 'Dining out'),
  b(['la pinoz', 'lapinoz', 'ovenstory', 'barbeque nation', 'barbequenation', 'absolute barbecues', 'mainland china', 'haldiram', 'haldirams'], 'Food', 'Dining out'),
  b(['meghana foods', 'empire restaurant', 'truffles', 'paradise biryani', 'behrouz biryani', 'mtr', 'a2b', 'sagar ratna', 'adyar ananda bhavan', 'saravana bhavan', 'vidyarthi bhavan'], 'Food', 'Dining out'),
  b(['eazydiner', 'dineout'], 'Food', 'Dining out'),
  // Food — cafés & chai
  b(['starbucks', 'tata starbucks'], 'Food', 'Cafés & chai'),
  b(['chaayos', 'chai point', 'chaipoint', 'chai sutta bar', 'third wave coffee', 'thirdwave', 'blue tokai', 'bluetokai'], 'Food', 'Cafés & chai'),
  b(['cafe coffee day', 'ccd', 'coffee day', 'barista', 'costa coffee', 'tim hortons', 'dunkin', 'mad over donuts'], 'Food', 'Cafés & chai'),
  // Food — snacks & sweets
  b(['baskin robbins', 'naturals ice cream', 'keventers', 'theobroma', 'kwality walls', 'amul parlour', 'hocco'], 'Food', 'Snacks & sweets'),

  // Groceries
  b(['blinkit', 'grofers', 'zepto', 'kiranakart', 'instamart', 'swiggy instamart', 'bbnow', 'bb now', 'flipkart minutes', 'amazon now'], 'Groceries', 'Quick delivery'),
  b(['bigbasket', 'big basket', 'supermarket grocery supplies', 'jiomart', 'jio mart', 'amazon fresh', 'dmart', 'd mart', 'avenue supermarts', 'reliance fresh', 'reliance smart', 'more retail', 'more supermarket', 'spencers', 'star bazaar', 'ratnadeep', 'nilgiris', 'metro cash', 'lulu hypermarket', 'namdhari'], 'Groceries', 'Supermarket'),
  b(['country delight', 'milkbasket', 'nandini', 'amul', 'akshayakalpa', 'heritage foods', 'otipy', 'pluckk'], 'Groceries', 'Fruit, veg & dairy'),

  // Transport
  b(['uber', 'uber india', 'olacabs', 'ola cabs', 'ani technologies', 'rapido', 'roppen', 'namma yatri', 'nammayatri', 'blusmart', 'indrive', 'quick ride'], 'Transport', 'Cabs & autos'),
  b(['ola'], 'Transport', 'Cabs & autos'),
  b(['bmtc', 'bmrcl', 'namma metro', 'dmrc', 'delhi metro', 'mumbai metro', 'hyderabad metro', 'chennai metro', 'cmrl', 'kmrl', 'best bus', 'tsrtc bus', 'mtc bus', 'ridlr'], 'Transport', 'Metro & bus'),
  b(['indian oil', 'indianoil', 'iocl', 'bharat petroleum', 'bpcl', 'hindustan petroleum', 'hpcl', 'shell india', 'nayara', 'jio bp', 'jiobp'], 'Transport', 'Fuel'),
  b(['fastag', 'netc', 'park plus', 'parkplus'], 'Transport', 'Parking & tolls'),
  b(['yulu', 'vogo', 'royal brothers'], 'Transport', 'Bike rental'),

  // Travel
  b(['irctc', 'indian railway', 'indianrail', 'confirmtkt', 'railyatri', 'ixigo trains'], 'Travel', 'Trains'),
  b(['indigo', 'interglobe', 'air india', 'airindia', 'akasa', 'spicejet', 'vistara', 'air india express'], 'Travel', 'Flights'),
  b(['redbus', 'abhibus', 'zingbus', 'intrcity', 'ksrtc', 'apsrtc', 'tsrtc', 'msrtc', 'vrl travels', 'srs travels'], 'Travel', 'Buses'),
  b(['oyo', 'oravel', 'airbnb', 'zostel', 'treebo', 'fabhotels', 'fab hotels', 'booking com', 'agoda'], 'Travel', 'Stays'),
  b(['makemytrip', 'make my trip', 'goibibo', 'ixigo', 'cleartrip', 'easemytrip'], 'Travel', null),

  // Shopping
  b(['amazon', 'amazon in', 'amazon seller', 'flipkart', 'meesho', 'snapdeal', 'tata cliq', 'tatacliq', 'shopsy'], 'Shopping', 'Online'),
  b(['myntra', 'ajio', 'zara', 'hennes', 'uniqlo', 'westside', 'trent', 'pantaloons', 'max fashion', 'shoppers stop', 'bewakoof', 'souled store', 'the souled store', 'snitch', 'bata', 'nike', 'adidas', 'puma', 'skechers', 'campus shoes', 'levis', 'fbb', 'zudio', 'v mart', 'vmart'], 'Shopping', 'Clothes & shoes'),
  b(['croma', 'reliance digital', 'vijay sales', 'apple india', 'samsung', 'xiaomi', 'boat lifestyle', 'imagine marketing', 'oneplus', 'poorvika', 'sangeetha mobiles'], 'Shopping', 'Electronics'),
  b(['ikea', 'pepperfry', 'urban ladder', 'home centre', 'miniso', 'decathlon', 'wakefit'], 'Shopping', 'Home & essentials'),
  b(['archies', 'ferns n petals', 'fnp', 'igp'], 'Shopping', 'Gifts'),

  // Personal care
  b(['nykaa', 'purplle', 'sugar cosmetics', 'mamaearth', 'plum goodness', 'minimalist', 'the body shop'], 'Personal care', 'Beauty'),
  b(['urban company', 'urbanclap', 'urban clap', 'naturals salon', 'green trends', 'toni guy', 'jawed habib', 'looks salon', 'lakme salon', 'bodycraft'], 'Personal care', 'Salon & grooming'),
  b(['cult fit', 'cultfit', 'curefit', 'cure fit', 'gold s gym', 'golds gym', 'anytime fitness', 'fitpass', 'playo', 'hudle'], 'Personal care', 'Gym & fitness'),
  b(['uclean', 'tumbledry', 'laundrokart', 'pressto'], 'Personal care', 'Laundry'),

  // Subscriptions
  b(['netflix', 'hotstar', 'disney hotstar', 'jiohotstar', 'jiocinema', 'sonyliv', 'sony liv', 'zee5', 'amazon prime', 'prime video', 'primevideo', 'mubi', 'crunchyroll', 'youtube premium'], 'Subscriptions', 'Streaming'),
  b(['spotify', 'apple music', 'youtube music', 'gaana', 'jiosaavn', 'wynk'], 'Subscriptions', 'Music'),
  b(['google play', 'google one', 'googleplay', 'apple com bill', 'itunes', 'icloud', 'microsoft', 'openai', 'chatgpt', 'anthropic', 'claude ai', 'notion', 'canva', 'github', 'adobe', 'dropbox', 'linkedin premium', 'duolingo'], 'Subscriptions', 'Apps & cloud'),
  b(['swiggy one', 'zomato gold', 'flipkart plus', 'times prime'], 'Subscriptions', 'Memberships'),

  // Outing
  b(['bookmyshow', 'book my show', 'bigtree', 'pvr', 'inox', 'pvr inox', 'cinepolis', 'carnival cinemas', 'miraj cinemas'], 'Outing', 'Movies'),
  b(['toit', 'arbor brewing', 'windmills', 'byg brewski', 'hard rock cafe', 'hoppipola', 'drunken monkey', 'bira 91', 'geist'], 'Outing', 'Bars & pubs'),
  b(['paytm insider', 'insider in', 'skillbox', 'allevents', 'townscript', 'ticketnew'], 'Outing', 'Events'),
  b(['smaaash', 'timezone', 'wonderla', 'imagicaa', 'funcity', 'snow city', 'mystery rooms', 'hamleys play'], 'Outing', 'Games & activities'),

  // Academics
  b(['udemy', 'coursera', 'unacademy', 'byjus', 'byju', 'physics wallah', 'physicswallah', 'upgrad', 'great learning', 'simplilearn', 'scaler', 'leetcode', 'geeksforgeeks', 'internshala', 'skillshare', 'edx', 'khan academy', 'vedantu'], 'Academics', 'Courses'),
  b(['sapna book house', 'sapna book', 'crossword', 'higginbothams', 'kitab khana', 'bookswagon', 'classmate', 'navneet', 'sbi collect', 'onlinesbi collect'], 'Academics', 'Books & stationery'),
  b(['nta', 'nta exam', 'upsc', 'ibps', 'gate exam', 'ets toefl', 'toefl', 'gre', 'ielts', 'british council', 'pearson vue', 'prometric'], 'Academics', 'Exams'),

  // Health
  b(['apollo pharmacy', 'apollo 247', 'apollo247', 'medplus', 'pharmeasy', 'netmeds', 'tata 1mg', '1mg', 'truemeds', 'wellness forever', 'frank ross'], 'Health', 'Pharmacy'),
  b(['apollo hospital', 'apollo hospitals', 'apollo clinic', 'practo', 'manipal hospital', 'fortis', 'narayana health', 'max healthcare', 'medanta', 'cloudnine', 'sakra', 'mfine', 'tata health'], 'Health', 'Doctor & clinic'),
  b(['apollo'], 'Health', null, true),
  b(['thyrocare', 'dr lal pathlabs', 'lal pathlabs', 'healthians', 'redcliffe', 'orange health', 'neuberg'], 'Health', 'Tests & labs'),

  // Bills
  b(['jio', 'reliance jio', 'jio prepaid', 'airtel', 'bharti airtel', 'airtel prepaid', 'vi prepaid', 'vodafone idea', 'vodafone', 'bsnl'], 'Bills', 'Mobile recharge'),
  b(['jio fiber', 'jiofiber', 'airtel xstream', 'airtel fiber', 'act fibernet', 'act broadband', 'hathway', 'excitel', 'you broadband', 'tata play fiber'], 'Bills', 'Internet'),
  b(['bescom', 'tneb', 'tangedco', 'msedcl', 'mahavitaran', 'bses', 'tata power', 'adani electricity', 'tsspdcl', 'apspdcl', 'cesc', 'uppcl', 'kseb', 'wbsedcl', 'torrent power', 'hescom', 'mescom', 'gescom', 'cescmysore'], 'Bills', 'Electricity'),
  b(['bwssb', 'djb', 'delhi jal board', 'bharatgas', 'bharat gas', 'hp gas', 'hpgas', 'igl', 'indraprastha gas', 'mahanagar gas', 'gail gas', 'adani gas'], 'Bills', 'Water & gas'),
  b(['nobrokerhood', 'mygate', 'apnacomplex'], 'Bills', 'Maintenance'),
  b(['tata play', 'tatasky', 'tata sky', 'dish tv', 'sun direct', 'airtel dth'], 'Subscriptions', 'Streaming'),

  // Rent
  b(['stanza living', 'stanza', 'zolo', 'zolostays', 'colive', 'yourspace', 'olive living', 'isthara', 'housr'], 'Rent', 'PG & hostel'),
  b(['nobroker', 'nestaway', 'housing com', 'magicbricks', 'cred rentpay', 'rentpay'], 'Rent', 'Rent'),
  // Names that are also ordinary words or places, so a match is only a guess.
  b(['social'], 'Outing', 'Bars & pubs', true),
  b(['district'], 'Outing', 'Events', true),
  b(['district by zomato'], 'Outing', 'Events'),
  b(['aha'], 'Subscriptions', 'Streaming', true),
  b(['aster'], 'Health', 'Doctor & clinic', true),
  b(['metropolis'], 'Health', 'Tests & labs', true),
  b(['settl', 'your space'], 'Rent', 'PG & hostel', true),
  b(['spectra'], 'Bills', 'Internet', true),
  b(['chalo'], 'Transport', 'Metro & bus', true),
  b(['lifestyle'], 'Shopping', 'Clothes & shoes', true),
  b(['bounce'], 'Transport', 'Bike rental', true),
  b(['meru'], 'Transport', 'Cabs & autos', true),
  b(['yatra'], 'Travel', null, true),
];

/** A generic word that gives away what kind of place this is. */
export interface Keyword {
  words: readonly string[];
  category: Category;
  sub: string | null;
  /**
   * Strong words are unambiguous on their own ("pharmacy", "xerox"). Weak ones
   * usually mean one thing but not always ("hotel" is a restaurant more often
   * than a room, "mart" is groceries more often than electronics) — a weak
   * match is only ever offered as a guess.
   */
  strong: boolean;
}

const k = (words: string[], category: Category, sub: string | null, strong: boolean): Keyword => ({
  words,
  category,
  sub,
  strong,
});

export const KEYWORDS: readonly Keyword[] = [
  k(['restaurant', 'restaurants', 'dhaba', 'biryani', 'pizza', 'pizzeria', 'burger', 'burgers', 'grill', 'kitchen', 'diner', 'eatery', 'tiffin', 'tiffins', 'darshini', 'udupi', 'thali', 'momos', 'momo', 'shawarma', 'rolls', 'dosa', 'idli', 'kebab', 'kebabs', 'barbeque', 'bbq', 'chinese', 'punjabi'], 'Food', 'Dining out', true),
  k(['hotel', 'bhavan', 'bhawan', 'foods', 'food', 'caterers', 'catering', 'annapoorna', 'bistro'], 'Food', 'Dining out', false),
  k(['cafe', 'cafes', 'caffe', 'coffee', 'chai', 'tea', 'chaiwala', 'teashop', 'brew', 'espresso', 'kaapi', 'filter coffee'], 'Food', 'Cafés & chai', true),
  k(['canteen', 'mess', 'cafeteria', 'food court', 'foodcourt'], 'Food', 'Canteen & mess', true),
  k(['bakery', 'bakers', 'bakes', 'cakes', 'sweets', 'sweet', 'mithai', 'juice', 'juices', 'shake', 'shakes', 'ice cream', 'icecream', 'creamery', 'chaat', 'pani puri', 'snacks', 'condiments', 'dessert', 'desserts', 'waffle', 'donut', 'donuts'], 'Food', 'Snacks & sweets', true),

  k(['kirana', 'provision', 'provisions', 'grocery', 'groceries', 'grocers', 'general store', 'general stores', 'departmental', 'department store'], 'Groceries', 'Kirana', true),
  k(['supermarket', 'hypermarket', 'super market'], 'Groceries', 'Supermarket', true),
  k(['mart', 'bazaar', 'bazar', 'traders', 'enterprises'], 'Groceries', 'Kirana', false),
  k(['dairy', 'milk', 'fruits', 'vegetables', 'veggies', 'fruit', 'organic', 'eggs', 'meat', 'chicken', 'mutton', 'fish'], 'Groceries', 'Fruit, veg & dairy', true),

  k(['cab', 'cabs', 'taxi', 'rickshaw'], 'Transport', 'Cabs & autos', true),
  k(['metro', 'bus', 'transport'], 'Transport', 'Metro & bus', false),
  k(['auto'], 'Transport', 'Cabs & autos', false),
  k(['petrol', 'diesel', 'fuel', 'fuels', 'filling station', 'petroleum', 'service station', 'cng'], 'Transport', 'Fuel', true),
  k(['parking', 'toll', 'tolls', 'plaza'], 'Transport', 'Parking & tolls', true),
  k(['tyres', 'tyre', 'motors', 'automobiles', 'garage', 'puncture', 'car wash', 'spares'], 'Transport', null, true),

  k(['railway', 'railways', 'train'], 'Travel', 'Trains', true),
  k(['airlines', 'airways', 'airport', 'aviation', 'flight', 'flights'], 'Travel', 'Flights', true),
  k(['travels', 'tours', 'holidays', 'travel'], 'Travel', null, false),
  k(['hostel', 'hostels', 'resort', 'resorts', 'homestay', 'lodge', 'inn', 'stays'], 'Travel', 'Stays', false),

  k(['fashion', 'fashions', 'garments', 'textiles', 'tailors', 'boutique', 'apparel', 'clothing', 'footwear', 'shoes', 'saree', 'sarees', 'collections'], 'Shopping', 'Clothes & shoes', true),
  k(['mobile'], 'Shopping', 'Electronics', false),
  k(['electronics', 'mobiles', 'computers', 'laptop', 'gadgets'], 'Shopping', 'Electronics', true),
  k(['hardware', 'furniture', 'furnishing', 'furnishings', 'appliances', 'utensils', 'plastics', 'home needs'], 'Shopping', 'Home & essentials', true),
  k(['gifts', 'gift', 'florist', 'flowers', 'toys'], 'Shopping', 'Gifts', true),

  k(['salon', 'saloon', 'parlour', 'parlor', 'barber', 'barbers', 'hair', 'unisex', 'spa', 'grooming'], 'Personal care', 'Salon & grooming', true),
  k(['gym', 'fitness', 'yoga', 'crossfit', 'turf', 'badminton', 'swimming'], 'Personal care', 'Gym & fitness', true),
  k(['sports'], 'Personal care', 'Gym & fitness', false),
  k(['cosmetics', 'beauty', 'makeup', 'skincare'], 'Personal care', 'Beauty', true),
  k(['laundry', 'dry clean', 'dryclean', 'drycleaners', 'dry cleaners', 'ironing', 'dhobi'], 'Personal care', 'Laundry', true),

  k(['subscription', 'premium', 'membership'], 'Subscriptions', null, false),

  k(['cinema', 'cinemas', 'multiplex', 'movies', 'theatre', 'theater'], 'Outing', 'Movies', true),
  k(['pub', 'brewery', 'brewpub', 'brewing', 'taproom', 'lounge', 'wines', 'liquor', 'beer', 'bar'], 'Outing', 'Bars & pubs', false),
  k(['concert', 'tickets', 'fest', 'festival', 'event', 'events', 'comedy', 'standup'], 'Outing', 'Events', false),
  k(['bowling', 'gaming', 'arcade', 'paintball', 'escape', 'trampoline', 'gokarting', 'karting', 'snooker'], 'Outing', 'Games & activities', true),

  k(['xerox', 'photocopy', 'printout', 'printouts', 'printing', 'prints', 'printers', 'print'], 'Academics', 'Print & xerox', true),
  k(['stationery', 'stationary', 'stationers', 'bookstore', 'booksellers', 'books', 'book depot', 'book house', 'book centre'], 'Academics', 'Books & stationery', true),
  k(['college', 'university', 'school', 'institute', 'academy', 'tuition', 'fees', 'fee', 'vidyalaya', 'vidyapeeth'], 'Academics', 'Fees', false),
  k(['exam', 'examination', 'admit', 'application fee'], 'Academics', 'Exams', false),
  k(['course', 'courses', 'classes', 'coaching', 'tutorials', 'learning'], 'Academics', 'Courses', false),

  k(['pharmacy', 'pharma', 'medical', 'medicals', 'medicines', 'chemist', 'chemists', 'druggist', 'drug', 'drugs'], 'Health', 'Pharmacy', true),
  k(['hospital', 'hospitals', 'clinic', 'clinics', 'dental', 'dentist', 'doctor', 'dr', 'healthcare', 'nursing home', 'physio', 'physiotherapy', 'eye care', 'opticals', 'optical'], 'Health', 'Doctor & clinic', true),
  k(['diagnostics', 'diagnostic', 'pathlab', 'pathlabs', 'labs', 'scan', 'scans'], 'Health', 'Tests & labs', true),

  k(['water'], 'Bills', 'Water & gas', false),
  k(['power'], 'Bills', 'Electricity', false),
  k(['recharge', 'prepaid', 'postpaid'], 'Bills', 'Mobile recharge', true),
  k(['electricity', 'discom', 'electric supply'], 'Bills', 'Electricity', true),
  k(['broadband', 'fibernet', 'internet', 'wifi', 'fiber'], 'Bills', 'Internet', true),
  k(['gas', 'lpg', 'cylinder', 'indane'], 'Bills', 'Water & gas', true),
  k(['maintenance', 'society', 'apartment', 'apartments', 'residency', 'owners association', 'rwa'], 'Bills', 'Maintenance', false),
  k(['bill', 'bills', 'billpay', 'bbps'], 'Bills', null, false),

  k(['pg', 'paying guest', 'co living', 'coliving'], 'Rent', 'PG & hostel', true),
  k(['rent', 'rental', 'lease'], 'Rent', 'Rent', true),
  k(['deposit'], 'Rent', 'Deposit', false),
];

/**
 * Common Indian given names and surnames. A payee written only in plain
 * words is a person when one of them is here ("Ramesh Kumar"), and probably
 * a shop when none is ("Bhukkad Adda"). These words are also never learned
 * as meaning a category, from anyone's correction.
 */
export const NAME_WORDS: ReadonlySet<string> = new Set(
  (
    'kumar singh sharma verma varma gupta reddy rao naidu patel shah mehta jain agarwal aggarwal agrawal ' +
    'bansal goyal mittal khan ahmed ahmad ali hussain husain shaikh sheikh iyer iyengar nair menon pillai ' +
    'kurian thomas joseph george mathew varghese das dutta datta ghosh bose banerjee chatterjee mukherjee ' +
    'chakraborty sen roy saha pal mishra tiwari tripathi pandey dubey shukla srivastava yadav chauhan ' +
    'thakur rathore rajput choudhary chaudhary chowdary chowdhury patil pawar jadhav kulkarni deshpande ' +
    'joshi desai naik gowda hegde shetty bhat kamath prabhu kapoor khanna malhotra arora bhatia sethi ' +
    'chopra ahuja gill sandhu sidhu dhillon grewal bajaj garg saxena mathur sinha prasad jha thakkar ' +
    'trivedi vyas pandya parmar solanki chawla babu murthy murty krishnan subramanian subramaniam raman ' +
    'swamy sastry shastri raju setty chetty goud kaur devi bai begum fatima lal nath ' +
    'rahul rohit amit ankit arjun aditya akash abhishek vikas vivek vijay ajay sanjay rajesh ramesh ' +
    'suresh mahesh dinesh ganesh naresh mukesh rakesh ravi raj sunil anil kiran prakash deepak manoj ' +
    'santosh sachin saurabh gaurav harsh harshit karan kunal nikhil nitin pankaj pranav pratik rishi ' +
    'sagar sahil sameer shubham siddharth sumit tarun varun vishal yash aman ayush tushar mohit neeraj ' +
    'priya pooja neha sneha anjali divya kavya shreya riya sakshi swati nisha megha anita sunita kavita ' +
    'rekha lakshmi meena radha sita geeta gita usha asha shalini deepa ritu jyoti preeti aarti arti ' +
    'komal payal simran tanvi isha ananya aishwarya bhavya keerthi keerthana srinivas srinivasa venkat ' +
    'venkatesh srikanth karthik karthikeyan arun vinod ashok murali bala balaji hari krishna gopal mohan ' +
    'mohammed mohammad mohd muhammad imran irfan salman faisal ashraf abdul syed rizwan zaid yusuf john ' +
    'peter paul david sai shiva siva surya teja chaitanya naveen praveen sandeep pradeep kishore manish ' +
    'ashish satish girish jagadish harish umesh yogesh rupesh ritesh hitesh nilesh mahendra surendra ' +
    'narendra jitendra rajendra devendra ramu shankar sundar anand aravind arvind vinay vinayak madhav ' +
    'madhu manju manjunath nagaraj nagesh prashant prashanth rohan rajat raghav raghu sanjana shweta ' +
    'swetha pallavi poonam rashmi ramya roopa sowmya soumya vidya vani veena harini hema'
  ).split(' ')
);

/** "Food · Delivery", or just "Food" when there is no sub-category. */
export function categoryLabel(category: string | null, subcategory: string | null): string {
  if (!category) return 'Uncategorised';
  return subcategory ? `${category} · ${subcategory}` : category;
}

/**
 * A category as a list row shows it: "Food · Delivery" when certain,
 * "Food · guess" when it is a guess waiting for a tap. The sub-category is
 * left off a guess to keep the row short; the detail sheet has room for it.
 */
export function rowCategoryLabel(
  t: { category: string | null; subcategory: string | null; category_source: string | null },
  blank = 'Uncategorised'
): string {
  if (!t.category) return blank;
  if (t.category_source === 'GUESS') return `${t.category} · guess`;
  return categoryLabel(t.category, t.subcategory);
}
