// Hand-written SEO content blocks for /c/:slug (SEO_STRATEGY.md §5).
// Calisthenics copy ships verbatim from §5.1; other categories follow the same skeleton.

export interface FaqItem {
  q: string;
  a: string;
}

export interface CategoryContent {
  intro: string;
  /** Per-attribute one-line explainers, keyed by attribute key. */
  attrExplainers: Record<string, string>;
  faq: FaqItem[];
}

const GENERIC_EXPLAINERS: Record<string, string> = {
  free: 'no entry fee or membership.',
  lighting: 'usable after dark.',
  access_24_7: 'not locked at night.',
  indoor_outdoor: 'whether the spot is outdoors or indoors.',
  quiet: 'reported as calm and low-traffic.',
  toilet: 'a toilet is available on site or immediately nearby.',
  overnight_allowed: 'sleeping here overnight is explicitly allowed.',
  drinking_water: 'drinking water is available on site.',
};

const calisthenics: CategoryContent = {
  intro:
    "A calisthenics park is an outdoor training area with bars and stations built for bodyweight exercise — pull-ups, dips, muscle-ups, human flags. Also called street workout parks or outdoor gyms, they're usually free and open around the clock, which makes them hard to find on conventional maps that only index commercial gyms. This map collects every calisthenics park the community has verified, worldwide. Zoom to your city, filter by the equipment you need, and tap a marker for photos and details.",
  attrExplainers: {
    pull_up_bars: 'at least one bar for pull-ups and muscle-ups.',
    parallel_bars: 'straight bars for dips and L-sits.',
    monkey_bars: 'a horizontal ladder for traversing.',
    rings: 'gymnastic rings, fixed or hanging.',
    dip_bars: 'dedicated dip station.',
    lighting: 'usable after dark.',
    free: 'no entry fee or membership.',
    access_24_7: 'not locked at night.',
    ground_surface: 'rubber, concrete, grass, sand or mixed (matters for falls and handstands).',
  },
  faq: [
    {
      q: 'Are calisthenics parks free to use?',
      a: 'Almost all are free public installations. Places marked "Free" cost nothing; if a park charges, the listing says so.',
    },
    {
      q: 'How do I find a calisthenics park near me?',
      a: 'Tap "Near Me" on the map — your location is used only in your browser and is never stored.',
    },
    {
      q: 'Can I train at night?',
      a: 'Filter by "Lighting" and "24/7 access" to see parks that stay open and lit after dark.',
    },
    {
      q: 'The park I know is missing — what do I do?',
      a: 'Tap "+ Add Place", drop a pin, and it appears after a quick check. Adding a park takes about a minute.',
    },
    {
      q: 'Is the information reliable?',
      a: 'Every listing shows when it was last confirmed by a community member ("Verified 12 days ago") and how many people confirmed it.',
    },
  ],
};

const armWrestling: CategoryContent = {
  intro:
    'Arm wrestling clubs and gyms with proper tables are surprisingly hard to find — most train in the back of ordinary gyms, bars, or community centers, and conventional maps rarely list them. This map collects dedicated arm wrestling clubs, gyms with armwrestling tables, and teams that hold regular training, worldwide. Filter for drop-ins if you just want to pull once, or for clubs with a competition team if you want to train seriously. Every listing shows when the community last confirmed it.',
  attrExplainers: {
    dedicated_club: 'an arm wrestling club, not just a table in a general gym.',
    armwrestling_table: 'at least one proper arm wrestling table.',
    regular_training: 'the group trains on a regular schedule.',
    competition_team: 'the club fields competitors at tournaments.',
    membership_required: 'you must join to train here.',
    drop_ins: 'you can show up and train without membership.',
    schedule: 'training days and times, when known.',
  },
  faq: [
    {
      q: 'Can I try arm wrestling without joining a club?',
      a: 'Yes — filter by "Drop-ins" to find places that welcome one-off visitors.',
    },
    {
      q: 'How do I find arm wrestling training near me?',
      a: 'Tap "Near Me" on the map — your location never leaves your browser.',
    },
    {
      q: 'My club is missing — how do I add it?',
      a: 'Tap "+ Add Place", drop a pin on your gym, and pick Arm Wrestling. It takes about a minute.',
    },
  ],
};

const vanlife: CategoryContent = {
  intro:
    'Vanlife spots are places where you can legally and comfortably spend the night in a van or camper — park-ups, rest areas, and quiet corners that conventional maps do not mark. This map collects community-verified vanlife spots worldwide, with the details that matter at 9pm: whether overnight parking is allowed, whether it is free, and whether there is water, a toilet, or a shower nearby. Filter by what you need tonight and tap a marker for photos and recent confirmations.',
  attrExplainers: {
    overnight_allowed: 'sleeping here overnight is explicitly allowed.',
    shower: 'a shower is available on site or nearby.',
    electricity: 'power hookups are available.',
    waste_disposal: 'grey/black water disposal on site.',
    mobile_signal: 'reported mobile coverage: none, weak or good.',
    height_restriction: 'maximum vehicle height, when known.',
    max_vehicle_length: 'maximum vehicle length in meters, when known.',
  },
  faq: [
    {
      q: 'Is it legal to sleep in my van here?',
      a: 'Places marked "Overnight allowed" are spots where sleeping overnight is explicitly permitted. Always check local signage on arrival.',
    },
    {
      q: 'How do I find a vanlife spot near me?',
      a: 'Tap "Near Me" on the map — your location is used only in your browser and is never stored.',
    },
    {
      q: 'How fresh is the information?',
      a: 'Every listing shows when a community member last confirmed it, and how many confirmed it.',
    },
  ],
};

const outdoorGyms: CategoryContent = {
  intro:
    'Outdoor gyms are free public fitness areas with fixed equipment — pull-up stations, chest presses, ellipticals, and bodyweight machines installed in parks. They sit between calisthenics parks and commercial gyms: no membership, no opening hours, often shaded and lit. This map collects outdoor gyms worldwide, with filters for lighting, 24/7 access and shade so you can find one that works at your training time.',
  attrExplainers: {
    shaded: 'protected from direct sun for part of the day.',
    equipment: 'what machines or stations are installed, in free text.',
  },
  faq: [
    {
      q: 'Are outdoor gyms really free?',
      a: 'Places marked "Free" cost nothing — they are public installations. If access is restricted, the listing says so.',
    },
    {
      q: 'Can I train at night?',
      a: 'Filter by "Lighting" and "24/7 access" to find gyms that stay open and lit after dark.',
    },
    {
      q: 'How do I add a missing outdoor gym?',
      a: 'Tap "+ Add Place", drop a pin, and it appears after a quick check.',
    },
  ],
};

const powerlifting: CategoryContent = {
  intro:
    'Powerlifting gyms are gyms properly equipped for the squat, bench press and deadlift — competition plates, deadlift platforms, and enough squat racks that you never wait. Conventional map reviews rarely mention any of this, so lifters end up asking in forums. This map collects powerlifting-friendly gyms worldwide, with filters for platforms, drop-ins and day passes so you can train while traveling.',
  attrExplainers: {
    competition_plates: 'calibrated competition plates available.',
    deadlift_platform: 'a dedicated platform for deadlifts.',
    squat_racks: 'number of squat racks or power cages.',
    day_pass_price: 'price of a single-day pass, when known.',
  },
  faq: [
    {
      q: 'Can I train once without a membership?',
      a: 'Filter by "Drop-ins" to find gyms that sell day passes to visitors.',
    },
    {
      q: 'How do I find a powerlifting gym near me?',
      a: 'Tap "Near Me" on the map — your location never leaves your browser.',
    },
  ],
};

const climbing: CategoryContent = {
  intro:
    'Climbing and bouldering spots — indoor gyms, outdoor crags, and public bouldering walls — collected in one map. Filter by bouldering or rope climbing, free outdoor spots, and rock type. Whether you are looking for a free public boulder wall in a new city or a crag with the right rock, this map shows what the community has verified, with photos and recent confirmations.',
  attrExplainers: {
    bouldering: 'bouldering is possible here.',
    rope_climbing: 'rope climbing (top-rope or lead) is possible here.',
    crash_pads_needed: 'bring your own crash pads for outdoor boulders.',
    rock_type: 'granite, limestone, sandstone or other rock.',
  },
  faq: [
    {
      q: 'Are there free outdoor bouldering spots?',
      a: 'Yes — filter by "Free" and "Bouldering" to find public outdoor walls and crags that cost nothing.',
    },
    {
      q: 'How do I add a climbing spot?',
      a: 'Tap "+ Add Place", drop a pin on the gym or crag, and pick Climbing / Bouldering.',
    },
  ],
};

const skateparks: CategoryContent = {
  intro:
    'Skateparks worldwide — concrete bowls, street sections, indoor parks and free public plazas. Filter by lighting for night sessions, by free access, or by features like a bowl or street section. Every listing shows photos, the surface, and when the community last confirmed the park is still there.',
  attrExplainers: {
    bowl: 'the park has a bowl or pool.',
    street_section: 'rails, ledges and stairs in a street-style area.',
    surface: 'concrete, wood or metal riding surface.',
  },
  faq: [
    {
      q: 'Can I skate at night?',
      a: 'Filter by "Lighting" to find parks that stay lit after dark.',
    },
    {
      q: 'How do I find a skatepark near me?',
      a: 'Tap "Near Me" on the map — your location is used only in your browser.',
    },
  ],
};

const parkour: CategoryContent = {
  intro:
    'Parkour spots are places with the right architecture for training jumps, vaults and climbs — walls, rails, gaps and levels in a compact area. The best spots spread by word of mouth; this map collects them in one place, with filters for lighting and 24/7 access so you know when you can train. Every spot is community-verified with photos.',
  attrExplainers: {},
  faq: [
    {
      q: 'Is parkour training allowed at these spots?',
      a: 'Listings reflect what the community reports. Always respect signage, property and other people using the space.',
    },
    {
      q: 'How do I add a spot?',
      a: 'Tap "+ Add Place", drop a pin, and pick Parkour Spots. It takes about a minute.',
    },
  ],
};

const basketball: CategoryContent = {
  intro:
    'Public basketball courts — outdoor streetball courts, free municipal courts and indoor halls that welcome drop-ins. Filter by lighting for evening runs, by free access, or by indoor/outdoor. Listings show the hoop count, surface and nets, plus photos and recent community confirmations.',
  attrExplainers: {
    hoops: 'number of hoops on the court.',
    nets: 'hoops have nets, not bare rims.',
    surface: 'asphalt, concrete, synthetic or wood.',
  },
  faq: [
    {
      q: 'Are these courts free to use?',
      a: 'Places marked "Free" are public courts that cost nothing.',
    },
    {
      q: 'Can I play after dark?',
      a: 'Filter by "Lighting" to find courts that stay lit at night.',
    },
  ],
};

const tableTennis: CategoryContent = {
  intro:
    'Public table tennis tables — the free outdoor tables in parks and squares that conventional maps almost never list. Filter by free access and lighting, and check whether you need to bring your own paddles. Listings show the number of tables, whether they are indoors or outdoors, and when the community last confirmed them.',
  attrExplainers: {
    tables: 'number of tables at the spot.',
    bring_own_paddles: 'no equipment rental — bring your own paddles and balls.',
  },
  faq: [
    {
      q: 'Do I need my own paddle?',
      a: 'Usually yes — check the "Bring own paddles" attribute on each listing.',
    },
    {
      q: 'How do I find a table near me?',
      a: 'Tap "Near Me" on the map — your location never leaves your browser.',
    },
  ],
};

const overnightParking: CategoryContent = {
  intro:
    'Overnight parking spots — rest areas, park-and-ride lots and quiet streets where sleeping in your vehicle overnight is allowed. Different from full vanlife spots: these are about a legal, safe night, not amenities. Filter by free access, toilets, security and quiet. Every listing shows when the community last confirmed it.',
  attrExplainers: {
    security: 'the area has lighting, cameras or patrols.',
    height_restriction: 'maximum vehicle height, when known.',
  },
  faq: [
    {
      q: 'Is overnight parking here legal?',
      a: 'Places marked "Overnight allowed" are spots where it is explicitly permitted. Always check local signage on arrival.',
    },
    {
      q: 'How fresh is the information?',
      a: 'Every listing shows when it was last confirmed by a community member.',
    },
  ],
};

const publicShowers: CategoryContent = {
  intro:
    'Public showers — beach showers, municipal bathhouses, gym day-pass showers and free public facilities — collected for travelers, vanlifers and anyone on the road. Filter by free access, 24/7 availability and hot water. Listings show the price when there is one, and when the community last confirmed the shower works.',
  attrExplainers: {
    hot_water: 'hot water is available, not just cold.',
    price: 'price per use, when known.',
  },
  faq: [
    {
      q: 'Are there free public showers?',
      a: 'Yes — filter by "Free" to see showers that cost nothing.',
    },
    {
      q: 'How do I find a shower near me?',
      a: 'Tap "Near Me" on the map — your location is used only in your browser.',
    },
  ],
};

const drinkingWater: CategoryContent = {
  intro:
    'Drinking water fountains and refill points — public taps, fountains and springs where you can fill a bottle for free. Essential for hikers, cyclists and travelers, and nearly invisible on conventional maps. Listings note whether the water is confirmed potable, whether the source is seasonal, and whether it runs around the clock.',
  attrExplainers: {
    seasonal: 'the source may be turned off in winter or dry months.',
    potable_confirmed: 'the community has confirmed the water is safe to drink.',
  },
  faq: [
    {
      q: 'Is the water safe to drink?',
      a: 'Look for "Potable confirmed" on the listing — it means a community member verified the water is drinkable.',
    },
    {
      q: 'How do I add a fountain?',
      a: 'Tap "+ Add Place", drop a pin on the tap or fountain, and pick Drinking Water.',
    },
  ],
};

const bbqPicnic: CategoryContent = {
  intro:
    'BBQ and picnic areas — public grills, fire pits and picnic tables in parks and forests. Filter by free access, built-in grills, and whether fires are allowed. Listings show whether there are tables, toilets and drinking water nearby, plus photos and recent confirmations from the community.',
  attrExplainers: {
    bbq_grill: 'a built-in grill or fire pit is installed.',
    fire_allowed: 'open fires are permitted.',
    tables: 'picnic tables are available.',
    toilets_nearby: 'toilets within a short walk.',
  },
  faq: [
    {
      q: 'Do I need to bring my own grill?',
      a: 'Check the "BBQ grill" attribute — places with it have a built-in grill or fire pit.',
    },
    {
      q: 'Are fires allowed everywhere?',
      a: 'No — check "Fire allowed" on each listing and always follow local fire restrictions.',
    },
  ],
};

const swimmingSpots: CategoryContent = {
  intro:
    'Swimming spots — wild swimming in seas, lakes and rivers, plus free public pools. Filter by water type, free access and entry type (beach, rocks or dock). Listings note cold water and lifeguards where the community has reported them, with photos and recent confirmations.',
  attrExplainers: {
    water_type: 'sea, lake, river or pool.',
    cold_water: 'known for cold water — relevant for winter swimming.',
    entry_type: 'beach, rocks or dock entry.',
    lifeguard: 'a lifeguard is on duty at least seasonally.',
  },
  faq: [
    {
      q: 'Are these spots safe?',
      a: 'Listings show lifeguard presence when known, but always assess conditions yourself before entering the water.',
    },
    {
      q: 'How do I find a swimming spot near me?',
      a: 'Tap "Near Me" on the map — your location never leaves your browser.',
    },
  ],
};

const viewpoints: CategoryContent = {
  intro:
    'Viewpoints — lookouts, terraces and hilltops with a view worth the trip. Filter by sunset or sunrise orientation and by whether a hike is required. Listings show seating, access hours and photos from the community, so you know what the view actually looks like before you go.',
  attrExplainers: {
    sunset_facing: 'faces west — good at sunset.',
    sunrise_facing: 'faces east — good at sunrise.',
    seating: 'benches or other seating at the viewpoint.',
    hike_required: 'you cannot drive to it — expect a walk.',
  },
  faq: [
    {
      q: 'Which viewpoints are best at sunset?',
      a: 'Filter by "Sunset facing" to see west-facing spots.',
    },
    {
      q: 'How do I add a viewpoint?',
      a: 'Tap "+ Add Place", drop a pin, and pick Viewpoints. It takes about a minute.',
    },
  ],
};

const sunsetSpots: CategoryContent = {
  intro:
    'Sunset spots — places specifically worth being at when the sun goes down: west-facing viewpoints, waterfronts and rooftops. Listings note seating, whether the spot is quiet or crowded at golden hour, and whether it is free. Every spot is community-verified with photos taken on location.',
  attrExplainers: {
    west_facing: 'faces west toward the setting sun.',
    seating: 'benches or other seating available.',
    crowded: 'typical crowd level at sunset: quiet, moderate or busy.',
  },
  faq: [
    {
      q: 'How do I avoid the crowds?',
      a: 'Check the "Crowded" attribute — spots marked "quiet" stay calm even at golden hour.',
    },
    {
      q: 'How do I find a sunset spot near me?',
      a: 'Tap "Near Me" on the map — your location is used only in your browser.',
    },
  ],
};

const photoSpots: CategoryContent = {
  intro:
    'Photography spots — locations known for a strong shot: cityscapes, architecture, nature, wildlife and street scenes. Filter by subject and best time of day, from sunrise to blue hour and night. Listings note drone-friendliness where reported, and every spot shows real photos from the community.',
  attrExplainers: {
    best_time: 'sunrise, golden hour, blue hour, night or anytime.',
    subject: 'cityscape, nature, architecture, wildlife or street.',
    drone_friendly: 'drone flight reported as tolerated — always check local rules.',
  },
  faq: [
    {
      q: 'When is the best light at these spots?',
      a: 'Each listing shows a "Best time" attribute — golden hour and blue hour spots are marked.',
    },
    {
      q: 'Can I fly a drone here?',
      a: 'Check the "Drone friendly" attribute, and always verify current local regulations yourself.',
    },
  ],
};

export const CATEGORY_CONTENT: Record<string, CategoryContent> = {
  calisthenics,
  'arm-wrestling': armWrestling,
  vanlife,
  'outdoor-gyms': outdoorGyms,
  powerlifting,
  climbing,
  skateparks,
  parkour,
  basketball,
  'table-tennis': tableTennis,
  'overnight-parking': overnightParking,
  'public-showers': publicShowers,
  'drinking-water': drinkingWater,
  'bbq-picnic': bbqPicnic,
  'swimming-spots': swimmingSpots,
  viewpoints,
  'sunset-spots': sunsetSpots,
  'photo-spots': photoSpots,
};

export function attrExplainer(categorySlug: string, key: string): string | null {
  const specific = CATEGORY_CONTENT[categorySlug]?.attrExplainers[key];
  if (specific) return specific;
  return GENERIC_EXPLAINERS[key] ?? null;
}
