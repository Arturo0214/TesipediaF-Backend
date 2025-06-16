/**
 * Calculate the impact level based on the number of incidents
 * @param {number} count - Number of incidents
 * @returns {string} Impact level (GREEN, YELLOW, or RED)
 */
export const calculateImpactLevel = (count) => {
    if (count === 0) return 'GREEN';
    if (count <= 3) return 'YELLOW';
    return 'RED';
};

/**
 * Generate GeoJSON for a street with its incidents
 * @param {string} streetName - Name of the street
 * @param {Array} coordinates - Array of [longitude, latitude] coordinates
 * @param {Array} incidents - Array of incidents for this street
 * @returns {Object} GeoJSON feature
 */
export const generateStreetGeoJSON = (streetName, coordinates, incidents) => {
    const highImpactCount = incidents.filter(i => i.impactLevel === 'HIGH').length;
    const lowImpactCount = incidents.filter(i => i.impactLevel === 'LOW').length;
    const totalCount = incidents.length;

    const impactLevel = calculateImpactLevel(totalCount);

    // Determine color based on impact level
    let color;
    switch (impactLevel) {
        case 'GREEN':
            color = '#4CAF50';
            break;
        case 'YELLOW':
            color = '#FFC107';
            break;
        case 'RED':
            color = '#F44336';
            break;
        default:
            color = '#4CAF50';
    }

    return {
        type: 'Feature',
        properties: {
            name: streetName,
            incidentCount: totalCount,
            highImpactCount,
            lowImpactCount,
            color,
            impactLevel
        },
        geometry: {
            type: 'LineString',
            coordinates
        }
    };
}; 