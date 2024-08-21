const userList = document.querySelector('[user-list-container]');
const teamOptionList = document.querySelectorAll('[team-options]');
const calculateTeamOption = document.querySelector('[calculate-team-options]');
const userOptionList = document.querySelectorAll('[user-options]');

const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
var leagueCode;
var isMobile;
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
    });
}

function displayUsers(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    var str = '';

    data.forEach( user => {
        str += '<tr>';
        str += '<td class="team-item">' + user.firstName + ' ' + user.lastName + '</td>';
        
        user.seasons[0].teams.forEach(team => {
            refLink = "https://www.sports-reference.com/cfb/schools/" + team.school;
            refLink = refLink.replace(/\s/g, "-").toLowerCase();

            str += '<td class="team-item"><div>';
            str += '<a target="_blank" href="' + refLink + '"><img src="' + team.logos[0] + '" alt="' + team.mascot + '">'
            str += team.mascot;
            str += '</div></td></a>';

        })
        str += '</tr>';
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
        var userLeague = data.user_metadata.metadata.league;
        var userRole = data.user_metadata.roles[0];

        if (userLeague == "gg") {
            leagueCode = "graham-league";
        } else {
            leagueCode = "claunts-league";
        }

        if (userRole != "Admin") {
            document.querySelector('[admin-page]').remove();
        }        

        getUsers();
    });
}



toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = async function() {
    detectMobile();
    getUserProfile();
    getTeams();
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
    
        const response = await fetch("/users", {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "firstName": "${firstName}",
            "lastName": "${lastName}",
            "color": "${displayColor}",
            "seasons": [
                {
                    "season": ${new Date().getFullYear()},
                    "teams": ${JSON.stringify(teamDocuments)}
                }
            ],
            "league": "${leagueCode}"
            }`,
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
    
        const team = document.querySelector('[calculate-team-options]').value;
        var teamName = "";

        var teamPromise = await fetch(`/teams/${team}`, {
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

        // await fetch(`/calculate-team-score/${team}/${teamName}`, {
        //     method: 'GET',
        //     headers: {
        //     'Accept': 'application/json'
        //     }
        // }).then(res => res.json()).then(data => {
        //     console.log("calculation successful.  response = " + res.status)
        // });

        // await fetch('/teams', {
        //     method: 'GET',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         'Accept': 'application/json'
        //     }
        // }).then(res => res.json()).then(data => {
        //     console.log("Number of teams: " + data.length)
        //     data.forEach(async (team) => {
        //         console.log(team.id + " | " + team.school);
        //         var response = await fetch(`/calculate-team-score/${team.id}/${team.school}`, {
        //             method: 'GET',
        //             headers: {
        //             'Accept': 'application/json'
        //             }
        //         });

        //         response.json().then(data => {
        //             if (response.status == 200) {
        //                 console.log(data);
        //                 successToast.options.text = "Score successfully calculated for " + data.school;
        //                 successToast.showToast();
        //             } else {
        //                 failToast.options.text = response.status + " Team score could not be calculated";
        //                 failToast.showToast();
        //             }
        //         });
        //     })
        // });

        var response = await fetch(`/calculate-team-score/${team}/${teamName}`, {
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

const rankingsForm = document.getElementById('rankings-form');

if (rankingsForm) {
    rankingsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const season = document.querySelector('[season]').value;
        const seasonType = document.querySelector('[season-type]').value.toLowerCase();
        const week = document.querySelector('[week]').value;

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

function displayCreateUserContainer() {
    var createUserContainer = document.querySelector('[create-user-container]');

    if (createUserContainer.style.display == 'block' || createUserContainer.style.display=='') {
        createUserContainer.style.display = 'none';
    } else {
        createUserContainer.style.display = 'block';
    }
}

function displayRemoveUserContainer() {
    var removeUserContainer = document.querySelector('[remove-user-container]');

    if (removeUserContainer.style.display == 'block' || removeUserContainer.style.display=='') {
        removeUserContainer.style.display = 'none';
    } else {
        removeUserContainer.style.display = 'block';
    }
}

function displayTeamContainer() {
    var removeUserContainer = document.querySelector('[calculate-team-score-container]');

    if (removeUserContainer.style.display == 'block' || removeUserContainer.style.display=='') {
        removeUserContainer.style.display = 'none';
    } else {
        removeUserContainer.style.display = 'block';
    }
}

function displayRankingsContainer() {
    var rankingsContainer = document.querySelector('[rankings-container]');

    if (rankingsContainer.style.display == 'block' || rankingsContainer.style.display=='') {
        rankingsContainer.style.display = 'none';
    } else {
        rankingsContainer.style.display = 'block';
    }
}