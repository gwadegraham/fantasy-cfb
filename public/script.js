const teamList = document.querySelector('[team-list-container]');
const pollName = document.querySelector('[poll-name]');
const pollForm = document.getElementById('get-poll-form');

const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = async function() {
    const currentSelectedLeague = window.localStorage.getItem("league");
    if (currentSelectedLeague) {
        $("#dropdownMenuButton").text(currentSelectedLeague);
    }

    await fetch('/top-25', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    }).then(res => res.json()).then(data => {
        displayTop25(data);
    });
};

$(".dropdown-menu a").click(function(){
    $(this).parents(".dropdown").find('.btn').html($(this).text());
    $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
    var selectedLeague = $("#dropdownMenuButton").text();
    var selectedLeagueCode = $("#dropdownMenuButton").val();
    window.localStorage.setItem("league", selectedLeague);
    window.localStorage.setItem("leagueCode", selectedLeagueCode);
});

function displayTop25(data) {
    var str = '<ol class="team-list">';

    data.ranks.forEach( team => {
        str += '<li class="team-item">' + team.school + '</li>';
    });

    str += '</ol>';
    teamList.innerHTML = str;
    pollName.textContent = data.poll;
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