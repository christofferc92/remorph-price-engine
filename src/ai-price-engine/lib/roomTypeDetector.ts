/**
 * Room Type Detection Utility
 * Determines project type (bathroom, kitchen, etc.) from user description
 */

export type RoomType = 'bathroom' | 'kitchen' | 'unclear';

export interface RoomTypeDetection {
    room_type: RoomType;
    confidence: 'low' | 'medium' | 'high';
    basis: string;
}

/**
 * Detect room type from user description
 */
export function detectRoomType(description: string): RoomTypeDetection {
    const lower = description.toLowerCase();

    // Kitchen keywords
    const kitchenKeywords = [
        /\bkök\b/,
        /\bkitchen\b/,
        /\bskåp\b/,
        /\bcabinet/,
        /\bbänkskiva\b/,
        /\bcountertop\b/,
        /\bworktop\b/,
        /\bdiskho\b/,
        /\bspis\b/,
        /\bkyl\b/,
        /\bfläkt\b/,
        /\bdiskmaskin\b/,
        /\bköksluckor\b/,
    ];

    // Bathroom keywords
    const bathroomKeywords = [
        /\bbadrum\b/,
        /\bbathroom\b/,
        /\bdusch\b/,
        /\bshower\b/,
        /\bbadkar\b/,
        /\bbathtub\b/,
        /\btoalett\b/,
        /\btoilet\b/,
        /\bhandfat\b/,
        /\bkakel\b/,
        /\btile/,
        /\btätskikt\b/,
        /\bwaterproof/,
        /\bgolvbrunn\b/,
    ];

    const kitchenMatches = kitchenKeywords.filter(pattern => lower.match(pattern)).length;
    const bathroomMatches = bathroomKeywords.filter(pattern => lower.match(pattern)).length;

    // Determine room type based on keyword matches
    if (kitchenMatches > bathroomMatches && kitchenMatches > 0) {
        return {
            room_type: 'kitchen',
            confidence: kitchenMatches >= 2 ? 'high' : 'medium',
            basis: `Found ${kitchenMatches} kitchen-specific keywords`
        };
    } else if (bathroomMatches > kitchenMatches && bathroomMatches > 0) {
        return {
            room_type: 'bathroom',
            confidence: bathroomMatches >= 2 ? 'high' : 'medium',
            basis: `Found ${bathroomMatches} bathroom-specific keywords`
        };
    } else if (kitchenMatches === bathroomMatches && kitchenMatches > 0) {
        // Tie - use context clues
        if (lower.match(/renovera|renovering|byt|byta/)) {
            // Generic renovation terms - unclear
            return {
                room_type: 'unclear',
                confidence: 'low',
                basis: 'Ambiguous - both kitchen and bathroom keywords found'
            };
        }
    }

    return {
        room_type: 'unclear',
        confidence: 'low',
        basis: 'No clear room type indicators found'
    };
}
