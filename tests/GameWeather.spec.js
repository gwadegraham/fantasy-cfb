const { weatherEmoji, toEmoji, isNotable, EMOJI_MAP } = require('../modules/game-weather');

describe('weatherEmoji', () => {
    test('snow conditions return snow', () => {
        expect(weatherEmoji('Snow showers', 28)).toBe('snow');
        expect(weatherEmoji('Light flurries', 30)).toBe('snow');
    });

    test('rain conditions return rain', () => {
        expect(weatherEmoji('Rain', 55)).toBe('rain');
        expect(weatherEmoji('Light showers', 60)).toBe('rain');
        expect(weatherEmoji('Drizzle', 50)).toBe('rain');
    });

    test('storm conditions return storm', () => {
        expect(weatherEmoji('Thunderstorms', 75)).toBe('storm');
        expect(weatherEmoji('Lightning', 80)).toBe('storm');
    });

    test('fog/mist returns fog', () => {
        expect(weatherEmoji('Fog', 45)).toBe('fog');
        expect(weatherEmoji('Mist', 50)).toBe('fog');
    });

    test('cloudy/overcast returns cloudy', () => {
        expect(weatherEmoji('Mostly Cloudy', 65)).toBe('cloudy');
        expect(weatherEmoji('Overcast', 60)).toBe('cloudy');
    });

    test('wind condition returns wind', () => {
        expect(weatherEmoji('Windy', 55)).toBe('wind');
    });

    test('freezing temp with non-snow condition returns cold', () => {
        expect(weatherEmoji('Clear', 18)).toBe('cold');
        expect(weatherEmoji('Partly Sunny', 32)).toBe('cold');
    });

    test('extreme heat returns hot', () => {
        expect(weatherEmoji('Sunny', 100)).toBe('hot');
        expect(weatherEmoji('Clear', 95)).toBe('hot');
    });

    test('sunny/clear at normal temp returns sunny', () => {
        expect(weatherEmoji('Sunny', 75)).toBe('sunny');
        expect(weatherEmoji('Clear', 70)).toBe('sunny');
        expect(weatherEmoji('Fair', 68)).toBe('sunny');
    });

    test('null condition with temp falls back to sunny', () => {
        expect(weatherEmoji(null, 70)).toBe('sunny');
    });

    test('null condition without temp returns null', () => {
        expect(weatherEmoji(null, null)).toBe(null);
    });

    test('null condition with extreme temp returns cold/hot', () => {
        expect(weatherEmoji(null, 20)).toBe('cold');
        expect(weatherEmoji(null, 100)).toBe('hot');
    });
});

describe('toEmoji', () => {
    test('maps tags to emoji characters', () => {
        expect(toEmoji('snow')).toBe('❄️');
        expect(toEmoji('rain')).toBe('🌧️');
        expect(toEmoji('dome')).toBe('🏟️');
        expect(toEmoji('sunny')).toBe('☀️');
    });

    test('returns null for unknown or null tag', () => {
        expect(toEmoji(null)).toBe(null);
        expect(toEmoji('unknown')).toBe(null);
    });
});

describe('isNotable', () => {
    test('snow, rain, storm, fog, cold, hot, wind are notable', () => {
        expect(isNotable({ emoji: 'snow' })).toBe(true);
        expect(isNotable({ emoji: 'rain' })).toBe(true);
        expect(isNotable({ emoji: 'storm' })).toBe(true);
        expect(isNotable({ emoji: 'cold' })).toBe(true);
        expect(isNotable({ emoji: 'hot' })).toBe(true);
        expect(isNotable({ emoji: 'wind' })).toBe(true);
    });

    test('sunny, cloudy, dome are not notable', () => {
        expect(isNotable({ emoji: 'sunny' })).toBe(false);
        expect(isNotable({ emoji: 'cloudy' })).toBe(false);
        expect(isNotable({ emoji: 'dome' })).toBe(false);
    });

    test('null/missing weather returns false', () => {
        expect(isNotable(null)).toBe(false);
        expect(isNotable({})).toBe(false);
    });
});
