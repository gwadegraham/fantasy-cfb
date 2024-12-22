const pollName = document.querySelector('[poll-name]');
const pollForm = document.getElementById('get-poll-form');

const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];

var leagueVersion;

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = async function() {
    const currentSelectedLeague = window.localStorage.getItem("league");
    if (currentSelectedLeague) {
        $("#dropdownMenuButton").text(currentSelectedLeague);
    }

    const response = await fetch(`/profile`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        console.log("user metadata", data)
        var userLeague = data.user_metadata.metadata.league;
        var userRole = data.user_metadata.roles[0];

        if (userLeague == "gg") {
            leagueVersion = "V2";
        } else {
            leagueVersion = "V1";
        }
    });

    await fetch('/teams', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    }).then(res => res.json()).then(data => {
        displayTeams(data);
    });
};

const myFunction = () => {
    const columns = [
      { name: 'Team', index: 0, isFilter: true },
      { name: 'Conference', index: 1, isFilter: true }
    ]
    const filterColumns = columns.filter(c => c.isFilter).map(c => c.index)
    const trs = document.querySelectorAll(`.fl-table tr:not(.headerRow)`)
    const filter = document.querySelector('#myInput').value.replace(/\s/g, "");
    const regex = new RegExp(escape(filter), 'i')
    const isFoundInTds = td => regex.test(td.innerHTML.replace(/\s/g, ""))
    const isFound = childrenArr => childrenArr.some(isFoundInTds)
    const setTrStyleDisplay = ({ style, children }) => {
      style.display = isFound([
        ...filterColumns.map(c => children[c]) // <-- filter Columns
      ]) ? '' : 'none'
    }
    
    trs.forEach(setTrStyleDisplay)
};

$(".dropdown-menu a").click(function(){
    $(this).parents(".dropdown").find('.btn').html($(this).text());
    $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
    var selectedLeague = $("#dropdownMenuButton").text();
    var selectedLeagueCode = $("#dropdownMenuButton").val();
    window.localStorage.setItem("league", selectedLeague);
    window.localStorage.setItem("leagueCode", selectedLeagueCode);
});

async function displayTeams(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    var str = '';

    // console.log(data[0])
    data.sort((a, b) => {
        if (leagueVersion == "V1") {
            var aScore = a.cumulativeScoreV1 || 0;
            var bScore = b.cumulativeScoreV1 || 0;
        } else {
            var aScore = a.cumulativeScoreV2 || 0;
            var bScore = b.cumulativeScoreV2 || 0;
        }
        
        return bScore - aScore;
    });

    // console.log(temp)
    var currentWeeksLength = 17;

    // data.sort((a, b) => a.cumulativeScoreV2 - b.cumulativeScoreV2);


    data.forEach( (team, index) => {
        var totalScore = 0;

        str += '<tr><td style="text-align: left; wi">';
        refLink = "https://www.sports-reference.com/cfb/schools/" + team.school;
        refLink = refLink.replace(/\s/g, "-").toLowerCase();

        // str += '<th class="team-item sticky-header"><div class="team-score-header">';
        str += '<a target="_blank" href="' + refLink + '"><img src="' + team.logos[0] + '" alt="' + team.mascot + '">'
        str += team.school;
        str += '</td>';

        str += '<td>' + team.conference + '</td>';

        if (leagueVersion == "V1") {
            str += '<td>' + (team.cumulativeScoreV1 || "0") + '</td>';
        } else {
            str += '<td>' + (team.cumulativeScoreV2 || "0") + '</td>';
        }
        

        str += '</tr>';
    });

    // str += '<tr>';
    // str += '<th class="team-item sticky-header"><div class="team-score-header">';
    // str += 'Cumulative Score';
    // str += '</div></th>';

    // data.weeklyScore.forEach(week => {
    //     str += '<td>' + week.score + '</td>'
    // });

    // for(var i = 0; i < (16 - currentWeeksLength); i++) {
    //     str += '<td>0</td>';
    // }

    // str += '<th class="sticky-header-score">' + data.cumulativeScore + '</th>';
    // str += '</tr>';

    userTableBody.innerHTML = str;

    // data.forEach( team => {
    //     str += '<li class="team-item">' + team.school + '</li>';
    // });

    // str += '</ol>';
    // teamList.innerHTML = str;
    // pollName.textContent = data.poll;
}

if (pollForm) {
    pollForm.addEventListener('submit', async function(event) {
        event.preventDefault();
    
        await fetch('/top-25', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        }).then(res => res.json()).then(data => {
            displayTop25(data);
        });
    });
}