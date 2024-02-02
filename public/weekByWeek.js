export function setChartData(data) {

    data.sort((a, b) => {
        return b.cumulativeScore - a.cumulativeScore;
    });

    const labels = [];
    const dataset = [];

    for (var i = 1; (i-1) < data[0].weeklyScore.length; i++) {
        labels.push("Week " + i);
    }

    data.forEach( (user, index) => {
        var scoreData = [];        
        var cumulativeScore = 0;

        user.weeklyScore.forEach( week => {
            cumulativeScore += week.score; 
            scoreData.push(cumulativeScore);
        });

        var userData = {
            label: user.firstName,
            data: scoreData,
            fill: false,
            backgroundColor: user.color,
            borderColor: user.color,
            tension: 0.1
        };

        dataset.push(userData);
    });

    const chartData = {
        labels: labels,
        datasets: dataset
    };

    const config = {
        type: 'line',
        data: chartData,
    };

    new Chart(
        document.getElementById('week-by-week'),
        config
    );
}