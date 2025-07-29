export function setChartData(data) {
    var chartMax = 100;

    data.sort((a, b) => {
        return b.seasons[0].cumulativeScore - a.seasons[0].cumulativeScore;
    });

    const labels = [];
    const dataset = [];

    for (var i = 0; (i-1) < data[0].seasons[0].weeklyScore.length; i++) {
        labels.push("Week " + i);
    }

    data.forEach( (user) => {
        var scoreData = [0];        
        var cumulativeScore = 0;

        chartMax = (user.seasons[0].weeklyScore.length * 17);

        user.seasons[0].weeklyScore.forEach( week => {
            cumulativeScore += week.score; 
            scoreData.push(cumulativeScore);
        });

        var userData = {
            label: user.firstName + " " + user.lastName.substring(-1,1),
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
        options: {
            scales: {
                x: {
                    ticks: {
                        color: '#F4F6FB',
                    }
                },
                y: {
                    beginAtZero: true,
                    min: 0,
                    max: chartMax,
                    ticks: {
                        color: '#F4F6FB',
                        stepSize : Math.round(chartMax / 7)
                    },
                }
            },
            plugins: {  // 'legend' now within object 'plugins {}'
                legend: {
                    labels: {
                        color: '#F4F6FB',
                    }
                }
            },
        }
    };

    new Chart(
        document.getElementById('week-by-week'),
        config
    );
}