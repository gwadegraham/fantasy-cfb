const userList = document.querySelector('[user-list-container]');
const teamOptionList = document.querySelectorAll('[team-options]');
const calculateTeamOption = document.querySelector('[calculate-team-options]');
const userOptionList = document.querySelectorAll('[user-options]');
const seasonOptionList = document.querySelectorAll('[season-options]');
const seasonTypeOptionList = document.querySelectorAll('[season-type-options]');
const weekOptionList = document.querySelectorAll('[week-options]');

var leagueCode;
var isMobile;
var userMetadata;
var teamList = [];
var userListSelect = [];

function detectMobile() {
    if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/.test(navigator.userAgent)){
        // true for mobile device
        isMobile = true;
    } else{
        // false for not mobile device
        isMobile = false;
    }
}

var successToast = Toastify({
    text: "",
    duration: 4000,
    close: true,
    gravity: "top", // `top` or `bottom`
    position: "left", // `left`, `center` or `right`
    stopOnFocus: true, // Prevents dismissing of toast on hover
    style: {
      background: "#71d28d",
      color: "#222"
    },
    offset: {
        y: '40px' // vertical axis - can be a number or a string indicating unity. eg: '2em'
    },
});

var failToast = Toastify({
    text: "",
    duration: 3000,
    close: true,
    gravity: "top", // `top` or `bottom`
    position: "left", // `left`, `center` or `right`
    stopOnFocus: true, // Prevents dismissing of toast on hover
    style: {
      background: "#d27171",
      color: "#222"
    },
    offset: {
        y: '40px' // vertical axis - can be a number or a string indicating unity. eg: '2em'
    },
});

async function getTeams() {
    fetch("/teams", {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    }).then(res => res.json()).then(data => {
        setTeamOptions(data);
    });
}

function multiplyNode(node, count, deep) {
    for (var i = 0, copy; i < count - 1; i++) {
        copy = node.cloneNode(deep);
        node.parentNode.insertBefore(copy, node);
    }
}

function setTeamOptions(data) {
    teamList = data;
    var str = '<option value="" disabled selected>Select A Team</option>';

    data.sort((a, b) => {
        return a.school.localeCompare(b.school)
    });

    data.forEach( team => {
        str += '<option value="';
        str += team.id;
        str += '">' + team.school;
        str += '</option>';
    });

    teamOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
    calculateTeamOption.innerHTML = str;

    multiplyNode(document.querySelector('.team-container'), 10, true);
}

function setSeasonOptions() {
    var currentYear = new Date().getFullYear();
    var years = [];

    for (let year = currentYear; year >= 2000; year--) {
        years.push(year);
    }

    var str = '<option value="" disabled selected>Season</option>';

    years.forEach( year => {
        str += '<option value="';
        str += year;
        str += '">' + year;
        str += '</option>';
    });

    seasonOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
}

function setSeasonTypeOptions() {
    var seasonTypes = ["Regular", "Postseason"];

    var str = '<option value="" disabled selected>Season Type</option>';

    seasonTypes.forEach( type => {
        str += '<option value="';
        str += type;
        str += '">' + type;
        str += '</option>';
    });

    seasonTypeOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
}

function setWeekOptions() {
    var weeks = [];

    for (let week = 1; week <=15; week++) {
        weeks.push(week);
    }

    var str = '<option value="" disabled selected>Week</option>';

    weeks.forEach( week => {
        str += '<option value="';
        str += week;
        str += '">' + week;
        str += '</option>';
    });

    weekOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
}

function setUserOptions(data) {
    userListSelect = data;
    var str = '<option value="" disabled selected>Select A Player</option>';

    data.forEach( user => {
        str += '<option value="';
        str += user._id;
        str += '">' + user.firstName + ' ' + user.lastName;
        str += '</option>';
    });

    userOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
}

async function getUsers() {
    const leagueCode = window.localStorage.getItem("leagueCode");
    const response = await fetch(`/users/league/${leagueCode}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(data => {
        displayUsers(data);
        setUserOptions(data);
        setNavbarUserId(userMetadata, data);
    });
}

function displayUsers(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    var str = '';

    data.forEach( user => {
        var userSeason = user.seasons[0];
        str += '<tr>';
        str += `<th class="sticky-header"><a href="/userHome?user=${user._id}">` + user.firstName + ' ' + user.lastName.substring(0,1) + '.</a></th>';
        str += '<td class="team-item">';
        
        for (var i = 0; i < user.seasons[0].teams.length; i++) {
            var team = userSeason.teams[i];
            var refLink = `/team?team=${team.id}`;

            str += '<div>';
            str += '<a href="' + refLink + '"><img src="' + team.logos.at(-1) + '" alt="' + team.mascot + '">'
            str += '</div></a>';
        }
        str += '</td></tr>';
    });

    userTableBody.innerHTML = str;
}

async function getUserProfile() {
    const response = await fetch(`/profile`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        console.log("user metadata", data)
        userMetadata = data;

        // Only set leagueCode from metaData if it's not already stored
        if (!window.localStorage.getItem("leagueCode") && data?.user_metadata?.metadata?.league) {
            var newLeagueCode = (data.user_metadata.metadata.league == 'gg' ? 'graham-league' : 'claunts-league');
            window.localStorage.setItem("leagueCode", newLeagueCode);
        }

        const leagueCode = window.localStorage.getItem("leagueCode");

        if (leagueCode && (leagueCode != "undefined")) {
            const currentSelectedLeague = window.sessionStorage.getItem("league");
            if (currentSelectedLeague) {
                $("#dropdownMenuButton").text(currentSelectedLeague);
            }
        }
        
        var userRole = data.user_metadata.roles[0];
        if (userRole != "Admin") {
            document.querySelector('[admin-page]').remove();
        }        

        getUsers();
    });
}

window.onload = async function() {
    function initNavbarToggle() {
        const toggleButton = document.querySelector('.toggle-button');
        const navbarLinks = document.querySelector('.navbar-links');

        if (toggleButton && navbarLinks) {
            toggleButton.addEventListener('click', () => {
                navbarLinks.classList.toggle('active');
            });
            console.log("✅ Navbar toggle initialized");
        } else {
            // Retry after 500ms if elements aren't in the DOM yet
            console.log("⏳ Navbar elements not found, retrying...");
            setTimeout(initNavbarToggle, 500);
        }
    }

    initNavbarToggle();

    detectMobile();
    getUserProfile();
    getTeams();
    setSeasonOptions();
    setSeasonTypeOptions();
    setWeekOptions();
};

const createForm = document.getElementById('create-form')

if (createForm) {
    createForm.addEventListener('submit', async function(event) {
        event.preventDefault();
    
        const firstName = document.querySelector('[first-name]').value;
        const lastName = document.querySelector('[last-name]').value;
        const displayColor = document.querySelector('[display-color]').value;
        const teams = [];
        const teamDocuments = [];
        document.querySelectorAll('[team-options]').forEach(
            team => {
                teams.push(team.value);
                var temp = teamList.find((element) => element.id == team.value);
                teamDocuments.push(temp);
            }
        );

        var userBody = {
            firstName: firstName,
            lastName: lastName,
            color: displayColor,
            seasons: [
                {
                    season: new Date().getFullYear()
                }
            ],
            league: leagueCode
        };

        if (teamDocuments[0] != null) {
            userBody.seasons[0].teams = JSON.stringify(teamDocuments);
        }
    
        const response = await fetch("/users", {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: JSON.stringify(userBody),
        });
    
       

        response.json().then(data => {
            if (response.status == 201) {
                createForm.reset();
                getUsers();
                displayCreateUserContainer();

                successToast.options.text = "User created successfully";
                successToast.showToast();
            } else {
                failToast.options.text = response.status + " User could not be created";
                failToast.showToast();
            }
        });
    });
}

const removeForm = document.getElementById('remove-form');

if (removeForm) {
    removeForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const userId = document.querySelector('[user-options]').value;
    
        const response = await fetch("/users/" + userId, {
            method: 'DELETE',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });
    
        response.json().then(data => {
            if (data.message == 'Deleted User') {
                removeForm.reset();
                getUsers();
                displayRemoveUserContainer();

                successToast.options.text = "User successfully deleted"
                successToast.showToast();
            } else {
                failToast.options.text = response.status + " User could not be deleted";
                failToast.showToast();
            }

        });
    });
}

const calculateForm = document.getElementById('score-form')

if (calculateForm) {
    calculateForm.addEventListener('submit', async function(event) {
        event.preventDefault();
    
        const teamId = document.querySelector('[calculate-team-options]').value;
        const season = document.querySelector('[team-score-season]').value;
        var teamName = "";

        var teamPromise = await fetch(`/teams/${teamId}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json'
            }
        });

        var teamResponse = await teamPromise;
        var response = await teamResponse.json();

        if (teamResponse.status == 200) {
            teamName = response[0].school;
        } else {
            console.log(response.message);
        }        

        var response = await fetch(`/calculate-team-score/${season}/${teamId}/${teamName}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json'
            }
        });

        response.json().then(data => {
            if (response.status == 200) {
                console.log(data);
                successToast.options.text = "Score successfully calculated for " + data.school;
                successToast.showToast();
            } else {
                failToast.options.text = response.status + " Team score could not be calculated";
                failToast.showToast();
            }
        });
    });
}

const calculateAllForm = document.getElementById('all-score-form')
if (calculateAllForm) {
    calculateAllForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const season = document.querySelector('[team-score-season]').value;

        await fetch('/teams', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        }).then(res => res.json()).then(data => {
            console.log("Number of teams: " + data.length)
            data.forEach(async (team) => {
                var response = await fetch(`/calculate-team-score/${season}/${team.id}/${team.school}`, {
                    method: 'GET',
                    headers: {
                    'Accept': 'application/json'
                    }
                });

                response.json().then(data => {
                    if (response.status == 200) {
                        console.log(data);
                        successToast.options.text = "Score successfully calculated for " + data.school;
                        successToast.showToast();
                    } else {
                        failToast.options.text = response.status + " Team score could not be calculated";
                        failToast.showToast();
                    }
                });
            })
        });
    });
}

const rankingsForm = document.getElementById('rankings-form');

if (rankingsForm) {
    rankingsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const season = document.querySelector('[rankings-season]').value;
        const seasonType = document.querySelector('[season-type-options]').value.toLowerCase();
        const week = document.querySelector('[week-options]').value;

        var response = await fetch(`/rankings/${season}/${week}/${seasonType}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });
    
        var rankings = await response;

        if (rankings.status == 200) {
            successToast.options.text = `Rankings already in system for Season: ${season}, Season Type: ${seasonType}, Week: ${week}`;
            successToast.showToast();
        } else {
            const response = await fetch("/rankings/retrieveRankings", {
                method: 'POST',
                headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                body: `{
                "season": "${season}",
                "seasonType": "${seasonType}",
                "week": "${week}"
                }`,
            });

            response.json().then(data => {
                if (response.status == 201) {
                    console.log("New Rankings", data);
                    successToast.options.text = `New rankings retrieved for Season: ${season}, Season Type: ${seasonType}, Week: ${week}`;
                    successToast.showToast();
                } else {
                    failToast.options.text = response.status + " Rankings could not be retrieved";
                    failToast.showToast();
                }
            });
        }
    });
}

const recruitRankingsForm = document.getElementById('recruit-rankings-form');

if (recruitRankingsForm) {
    recruitRankingsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[recruiting-season]').value;

        var response = await fetch(`/recruiting/${season}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });
    
        var recruitingRankings = await response;

        if (recruitingRankings.status == 200) {
            successToast.options.text = `Recruiting Rankings already in system for Season: ${season}`;
            successToast.showToast();
        } else {
            const response = await fetch(`/recruiting/new/${season}`, {
                method: 'POST',
                headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                body: `{
                "season": "${season}"
                }`,
            });

            response.json().then(data => {
                if (response.status == 201) {
                    console.log("New Recruiting Rankings", data);
                    successToast.options.text = `New recruiting rankings retrieved for Season: ${season}`;
                    successToast.showToast();
                    unblock_screen();
                } else {
                    failToast.options.text = response.status + " Recruiting Rankings could not be retrieved";
                    failToast.showToast();
                }
            });
        }
    });
}

const teamRecordsForm = document.getElementById('team-records-form');

if (teamRecordsForm) {
    teamRecordsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[record-season]').value;

        const response = await fetch(`/records/new/${season}`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "season": "${season}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("New Team Records", data);
                successToast.options.text = `New team records retrieved for Season: ${season}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + " Team Records could not be retrieved";
                failToast.showToast();
            }
        });
    });
}

const refreshTeamsForm = document.getElementById('refresh-teams-form');

if (refreshTeamsForm) {
    refreshTeamsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[refresh-season]').value;

        const response = await fetch(`/teams/refresh`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "year": "${season}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("Refreshed Teams", data);
                successToast.options.text = `Teams refreshed for Season: ${season}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + " Teams could not be refreshed";
                failToast.showToast();
            }
        });
    });
}

const gamesForm = document.getElementById('games-form');

if (gamesForm) {
    gamesForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        
        block_screen();

        const week = document.querySelector('[game-week]').value;
        const seasonType = document.querySelector('[game-season-type]').value.toLowerCase();

        const response = await fetch(`/games/week/mass-create`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "week": "${week}",
            "seasonType": "${seasonType}"
            }`
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("New Games Successfully Saved");
                successToast.options.text = `Games retrieved for  Week: ${week}, Season Type: ${seasonType}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + "| Games could not be retrieved";
                failToast.showToast();            }
        });
    });
}

const scoresForm = document.getElementById('scores-form');

if (scoresForm) {
    scoresForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        
        block_screen();

        const week = document.querySelector('[score-week]').value;
        const seasonType = document.querySelector('[score-season-type]').value.toLowerCase();

        const response = await fetch(`/scores/update`, {
            method: 'POST',
            signal: AbortSignal.timeout(100000),
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "seasonType": "${seasonType}",
            "week": "${week}"
            }`
        });

        response.json().then(data => {
            if (response.status == 200) {
                console.log("Scores Successfully Updated");
                successToast.options.text = `Scores updated for Season Type: ${seasonType}, Week: ${week}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + "| Scores could not be updated";
                failToast.showToast();            }
        });
    });
}

const bettingLinesForm = document.getElementById('betting-lines-form');

if (bettingLinesForm) {
    bettingLinesForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[betting-season]').value;

        const response = await fetch(`/betting/new/${season}`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "season": "${season}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("New Betting Records", data);
                successToast.options.text = `New betting records retrieved for Season: ${season}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + " Betting Records could not be retrieved";
                failToast.showToast();
            }
        });
    });
}

const expectedWinsForm = document.getElementById('expected-wins-form');

if (expectedWinsForm) {
    expectedWinsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[expected-wins-season]').value;

        const response = await fetch(`/teams/${season}/expectedWins`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: `{
            "season": "${season}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 200) {
                console.log("Updated team records", data);
                successToast.options.text = `Team expected wins updated for Season: ${season}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + " Team expected wins could not be updated";
                failToast.showToast();
            }
        });
    });
}

function displayCreateUserContainer() {
    var createUserContainer = document.querySelector('[create-user-container]');

    if (createUserContainer.style.display == 'flex' || createUserContainer.style.display=='') {
        createUserContainer.style.display = 'none';
    } else {
        createUserContainer.style.display = 'flex';
    }
}

function displayRemoveUserContainer() {
    var removeUserContainer = document.querySelector('[remove-user-container]');

    if (removeUserContainer.style.display == 'flex' || removeUserContainer.style.display=='') {
        removeUserContainer.style.display = 'none';
    } else {
        removeUserContainer.style.display = 'flex';
    }
}

function displayTeamContainer() {
    var teamScoreContainer = document.querySelector('[calculate-team-score-container]');

    if (teamScoreContainer.style.display == 'flex' || teamScoreContainer.style.display=='') {
        teamScoreContainer.style.display = 'none';
    } else {
        teamScoreContainer.style.display = 'flex';
    }
}

function displayRankingsContainer() {
    var rankingsContainer = document.querySelector('[rankings-container]');

    if (rankingsContainer.style.display == 'flex' || rankingsContainer.style.display=='') {
        rankingsContainer.style.display = 'none';
    } else {
        rankingsContainer.style.display = 'flex';
    }
}

function displayRecruitRankingsContainer() {
    var recruitRankingsContainer = document.querySelector('[recruit-rankings-container]');

    if (recruitRankingsContainer.style.display == 'flex' || recruitRankingsContainer.style.display=='') {
        recruitRankingsContainer.style.display = 'none';
    } else {
        recruitRankingsContainer.style.display = 'flex';
    }
}

function displayTeamRecordsContainer() {
    var teamRecordsContainer = document.querySelector('[team-records-container]');

    if (teamRecordsContainer.style.display == 'flex' || teamRecordsContainer.style.display=='') {
        teamRecordsContainer.style.display = 'none';
    } else {
        teamRecordsContainer.style.display = 'flex';
    }
}

function displayRefreshTeamsContainer() {
    var refreshTeamsContainer = document.querySelector('[refresh-teams-container]');

    if (refreshTeamsContainer.style.display == 'flex' || refreshTeamsContainer.style.display=='') {
        refreshTeamsContainer.style.display = 'none';
    } else {
        refreshTeamsContainer.style.display = 'flex';
    }
}

function displayGamesContainer() {
    var gamesContainer = document.querySelector('[games-container]');

    if (gamesContainer.style.display == 'flex' || gamesContainer.style.display=='') {
        gamesContainer.style.display = 'none';
    } else {
        gamesContainer.style.display = 'flex';
    }
}

function displayScoresContainer() {
    var scoresContainer = document.querySelector('[scores-container]');

    if (scoresContainer.style.display == 'flex' || scoresContainer.style.display=='') {
        scoresContainer.style.display = 'none';
    } else {
        scoresContainer.style.display = 'flex';
    }
}

function displayBettingLinesContainer() {
    var bettingContainer = document.querySelector('[betting-lines-container]');

    if (bettingContainer.style.display == 'flex' || bettingContainer.style.display=='') {
        bettingContainer.style.display = 'none';
    } else {
        bettingContainer.style.display = 'flex';
    }
}

function displayExpectedWinsContainer() {
    var expectedWinsContainer = document.querySelector('[expected-wins-container]');

    if (expectedWinsContainer.style.display == 'flex' || expectedWinsContainer.style.display=='') {
        expectedWinsContainer.style.display = 'none';
    } else {
        expectedWinsContainer.style.display = 'flex';
    }
}

function block_screen() {
    console.log("running block screen")
    $('<div id="screenBlock"></div>').appendTo('body');
    $('#screenBlock').css( { opacity: 0, width: $(document).width(), height: $(document).height() } );
    $('#screenBlock').addClass('blockDiv');
    $('#screenBlock').animate({opacity: 0.7}, 200);
}

function unblock_screen() {
$('#screenBlock').animate({opacity: 0}, 200, function() {
    $('#screenBlock').remove();
});
}

setTimeout(() => {
    $("[league-selector] a").click(function(){
        $(this).parents(".dropdown").find('.btn').html($(this).text());
        $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
        var selectedLeague = $("#dropdownMenuButton").text();
        var selectedLeagueCode = $("#dropdownMenuButton").val();
        window.sessionStorage.setItem("league", selectedLeague);
        window.localStorage.setItem("leagueCode", selectedLeagueCode);
        window.location.reload();
    });
}, "200");

function setNavbarUserId(metaData, usersData) {
    if (!metaData || !metaData.email || !Array.isArray(usersData)) {
        return null;
    }

    const email = metaData.email.toLowerCase();
    const user = usersData.find(u => u.email && u.email.toLowerCase() == email);
    const userId = user ? user._id : null;
    
    const myLink = document.querySelector('[user-home]');
    myLink.href = `/userHome?user=${userId}`;
}