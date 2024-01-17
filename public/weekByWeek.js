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
        var color = generateNewColor();
        
        var cumulativeScore = 0;

        user.weeklyScore.forEach( week => {
            cumulativeScore += week.score; 
            scoreData.push(cumulativeScore);
        });

        var userData = {
            label: user.firstName,
            data: scoreData,
            fill: false,
            backgroundColor: color,
            borderColor: color,
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

const hexCharacters = [0,1,2,3,4,5,6,7,8,9,"A","B","C","D","E","F"]

function getCharacter(index) {
	return hexCharacters[index]
}

function generateNewColor() {
	let hexColorRep = "#"

	for (let index = 0; index < 6; index++){
		const randomPosition = Math.floor ( Math.random() * hexCharacters.length ) 
    	hexColorRep += getCharacter( randomPosition )
	}
	
	return hexColorRep
}