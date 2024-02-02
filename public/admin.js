const userList = document.querySelector('[user-list-container]');
const teamOptionList = document.querySelectorAll('[team-options]');
const userOptionList = document.querySelectorAll('[user-options]');

const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
var leagueCode;
var teamList = [];
var userListSelect = [];

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
      background: "#71d28d",
      color: "#222"
    },
    offset: {
        y: '40px' // vertical axis - can be a number or a string indicating unity. eg: '2em'
    },
});

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = function() {
    leagueCode = window.localStorage.getItem("leagueCode");
    const currentSelectedLeague = window.localStorage.getItem("league");
    if (currentSelectedLeague) {
        $("#dropdownMenuButton").text(currentSelectedLeague);
    }

    getUsers();
};

$(".dropdown-menu a").click(function(){
    $(this).parents(".dropdown").find('.btn').html($(this).text());
    $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
    var selectedLeague = $("#dropdownMenuButton").text();
    var selectedLeagueCode = $("#dropdownMenuButton").val();
    window.localStorage.setItem("league", selectedLeague);
    window.localStorage.setItem("leagueCode", selectedLeagueCode);
    window.location.reload();
});

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


fetch("/teams", {
    method: 'GET',
    headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
    }
}).then(res => res.json()).then(data => {
    setTeamOptions(data);
});

function setTeamOptions(data) {
    teamList = data;
    var str = '<option value="" disabled selected>Select A Team</option>';

    data.forEach( team => {
        str += '<option value="';
        str += team.id;
        str += '">' + team.school;
        str += '</option>';
    });

    teamOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
    multiplyNode(document.querySelector('.team-container'), 10, true);
}

function multiplyNode(node, count, deep) {
    for (var i = 0, copy; i < count - 1; i++) {
        copy = node.cloneNode(deep);
        node.parentNode.insertBefore(copy, node);
    }
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
            "teams": ${JSON.stringify(teamDocuments)},
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
    
        const teams = [];
        const teamDocuments = [];
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

function displayUsers(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    var str = '';

    data.forEach( user => {
        str += '<tr>';
        str += '<td class="team-item">' + user.firstName + ' ' + user.lastName + '</td>';
        
        user.teams.forEach(team => {
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

