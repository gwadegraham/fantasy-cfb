(function () {
    var container = document.getElementById('cfp-bracket');

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function logo(logos) {
        return window.ccLogo ? window.ccLogo(logos) : (logos && logos[0] || '');
    }

    function colorHex(c) {
        if (!c) return null;
        return c.startsWith('#') ? c : '#' + c;
    }

    function dateFmt(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' });
    }

    function timeFmt(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
    }

    function roundLabel(round) {
        var labels = {
            first_round: 'First Round',
            quarterfinal: 'Quarterfinals',
            semifinal: 'Semifinals',
            championship: 'National Championship'
        };
        return labels[round] || round;
    }

    function roundShortLabel(round) {
        var labels = {
            first_round: 'R1',
            quarterfinal: 'QF',
            semifinal: 'SF',
            championship: 'CHAMP'
        };
        return labels[round] || round;
    }

    function statusPill(game) {
        if (!game) return '';
        if (game.completed) return '<span class="cfp-pill cfp-final">Final</span>';
        if (game.period) return '<span class="cfp-pill cfp-live">Q' + game.period + (game.clock ? ' ' + game.clock : '') + '</span>';
        if (game.startDate) return '<span class="cfp-pill cfp-scheduled">' + dateFmt(game.startDate) + '</span>';
        return '';
    }

    function teamCard(team, game, isWinner) {
        if (!team) {
            return '<div class="cfp-team cfp-team-tbd"><div class="cfp-team-seed">-</div>' +
                   '<div class="cfp-team-logo-wrap"><div class="cfp-team-logo-placeholder"></div></div>' +
                   '<div class="cfp-team-info"><span class="cfp-team-name">TBD</span></div></div>';
        }

        var teamColor = colorHex(team.color) || 'var(--cc-muted-2)';
        var score = team.score != null ? team.score : '';
        var winClass = isWinner ? ' cfp-winner' : '';
        var loserClass = (game && game.completed && !isWinner && team.score != null) ? ' cfp-loser' : '';

        var ownerHtml = '';
        if (team.owner) {
            var ownerColor = team.owner.color ? colorHex(team.owner.color) : 'var(--cc-interactive)';
            ownerHtml = '<a href="/userHome?user=' + team.owner.userId + '" class="cfp-owner" style="--owner-color:' + ownerColor + '">' +
                        escapeHtml(team.owner.franchise) + '</a>';
        }

        return '<div class="cfp-team' + winClass + loserClass + '" style="--team-color:' + teamColor + '">' +
               '<div class="cfp-team-seed">' + (team.seed || '-') + '</div>' +
               '<a href="/team?team=' + team.teamId + '" class="cfp-team-logo-wrap">' +
               '<img class="cfp-team-logo" src="' + logo(team.logos) + '" alt="' + escapeHtml(team.school) + '" onerror="this.style.display=\'none\'">' +
               '</a>' +
               '<div class="cfp-team-info">' +
               '<a href="/team?team=' + team.teamId + '" class="cfp-team-name">' + escapeHtml(team.school) + '</a>' +
               ownerHtml +
               '</div>' +
               (score !== '' ? '<div class="cfp-team-score">' + score + '</div>' : '') +
               '</div>';
    }

    function matchupCard(bracketGame, data) {
        var game = bracketGame.game;
        var teams = bracketGame.teams || [];
        var t1 = teams[0] || null;
        var t2 = teams[1] || null;

        var winner = null;
        if (game && game.completed && t1 && t2 && t1.score != null && t2.score != null) {
            winner = t1.score > t2.score ? t1.teamId : (t2.score > t1.score ? t2.teamId : null);
        }

        var venueHtml = '';
        if (bracketGame.bowlName) {
            venueHtml += '<span class="cfp-game-bowl">' + escapeHtml(bracketGame.bowlName) + '</span>';
        }
        if (game && game.venue) {
            venueHtml += (venueHtml ? '<span class="cfp-meta-dot"></span>' : '') +
                         '<span class="cfp-game-venue">' + escapeHtml(game.venue) + '</span>';
        } else if (bracketGame.projectedVenue) {
            venueHtml += (venueHtml ? '<span class="cfp-meta-dot"></span>' : '') +
                         '<span class="cfp-game-venue">' + escapeHtml(bracketGame.projectedVenue) + '</span>';
        }
        if (game && game.outlet) {
            venueHtml += (venueHtml ? '<span class="cfp-meta-dot"></span>' : '') +
                         '<span class="cfp-game-outlet"><i class="fas fa-tv"></i> ' + escapeHtml(game.outlet) + '</span>';
        }

        // Down-and-distance, live only. The field is nulled when a game finals,
        // but `completed` is checked too — it is the flag every ingest path
        // agrees on, and a stale "3rd & 7" under a final score reads as broken.
        if (game && !game.completed && game.situation) {
            venueHtml = '<span class="cfp-game-situation">' + escapeHtml(game.situation) + '</span>' +
                        (venueHtml ? '<span class="cfp-meta-dot"></span>' + venueHtml : '');
        }

        var roundPts = data.pointsByRound[bracketGame.round] || 0;
        var ptsLabel = roundPts ? '+' + roundPts + ' pts' : '';
        if (bracketGame.round === 'quarterfinal' && data.pointsByRound.quarterfinalByeBonus) {
            ptsLabel += ' <span class="cfp-bye-bonus">(+' + data.pointsByRound.quarterfinalByeBonus + ' bye bonus)</span>';
        }

        var gameId = bracketGame.gameId;
        var clickAttr = gameId ? ' onclick="window.location.href=\'/game/' + gameId + '\'"' : '';
        var clickClass = gameId ? ' cfp-matchup-clickable' : '';

        return '<div class="cfp-matchup' + clickClass + '" data-round="' + bracketGame.round + '" data-slot="' + (bracketGame.bracketSlot || '') + '"' + clickAttr + '>' +
               '<div class="cfp-matchup-header">' +
               statusPill(game) +
               (ptsLabel ? '<span class="cfp-matchup-pts">' + ptsLabel + '</span>' : '') +
               '</div>' +
               teamCard(t1, game, t1 && winner === t1.teamId) +
               '<div class="cfp-matchup-divider"></div>' +
               teamCard(t2, game, t2 && winner === t2.teamId) +
               (venueHtml ? '<div class="cfp-matchup-meta">' + venueHtml + '</div>' : '') +
               '</div>';
    }

    function franchiseCard(franchise, data) {
        var color = franchise.color ? colorHex(franchise.color) : 'var(--cc-interactive)';
        var teamsHtml = franchise.teams.map(function (t) {
            var teamColor = colorHex(t.color) || 'var(--cc-muted-2)';
            return '<a href="/team?team=' + t.teamId + '" class="cfp-fs-team" style="--team-color:' + teamColor + '">' +
                   '<img src="' + logo(t.logos) + '" class="cfp-fs-logo" onerror="this.style.display=\'none\'">' +
                   '<span class="cfp-fs-seed">#' + t.seed + '</span>' +
                   '<span class="cfp-fs-school">' + escapeHtml(t.school) + '</span>' +
                   '</a>';
        }).join('');

        var avatarHtml = '';
        if (franchise.avatarUrl) {
            avatarHtml = '<img src="' + franchise.avatarUrl + '" class="cfp-franchise-avatar" onerror="this.style.display=\'none\'">';
        } else {
            var initials = (((franchise.firstName || '')[0] || '') + ((franchise.lastName || '')[0] || '')).toUpperCase() || '?';
            avatarHtml = '<span class="cfp-franchise-avatar cfp-franchise-avatar-initials" style="background:' + color + '">' + escapeHtml(initials) + '</span>';
        }

        var narrativeHtml = franchise.narrative
            ? '<div class="cfp-franchise-narrative">' + escapeHtml(franchise.narrative) + '</div>'
            : '';

        return '<div class="cfp-franchise-card" style="--owner-color:' + color + '">' +
               '<div class="cfp-franchise-header">' +
               avatarHtml +
               '<a href="/userHome?user=' + franchise.userId + '" class="cfp-franchise-name">' + escapeHtml(franchise.franchise) + '</a>' +
               '<span class="cfp-franchise-pts">' + franchise.maxPoints + ' max pts</span>' +
               '</div>' +
               '<div class="cfp-franchise-teams">' + teamsHtml + '</div>' +
               narrativeHtml +
               '</div>';
    }

    async function load() {
        try {
            var activeLeague = (typeof ccLeague !== 'undefined' && ccLeague.code()) || LEAGUE;
            var res = await fetch('/playoffs/bracket/' + SEASON + '/' + activeLeague);
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                throw new Error(err.message || 'Failed to load bracket');
            }
            var data = await res.json();

            render(data);
            cfpSchedule(data);
        } catch (e) {
            container.innerHTML = '<div class="cfp-error">' +
                '<i class="fas fa-football-ball"></i>' +
                '<p>' + escapeHtml(e.message) + '</p>' +
                '<a href="/standings">Back to Standings</a></div>';
        }
    }

    // ---- live refresh ---------------------------------------------------
    //
    // Same 30s cadence and hidden-tab rule as the league scoreboard. A bracket
    // is at most a handful of games and only ever live in late December, so the
    // timer arms only while one of them is actually in progress.
    var CFP_LIVE_MS = 30000;
    var cfpTimer = null;
    var cfpData = null;

    function cfpAnyLive(data) {
        var now = Date.now();
        return (data && data.games || []).some(function (bg) {
            var g = bg.game;
            return g && !g.completed && g.startDate && Date.parse(g.startDate) <= now;
        });
    }

    function cfpSchedule(data) {
        cfpData = data;
        clearTimeout(cfpTimer);
        if (!cfpAnyLive(data) || document.hidden) return;
        cfpTimer = setTimeout(cfpRefresh, CFP_LIVE_MS);
    }

    async function cfpRefresh() {
        try {
            var activeLeague = (typeof ccLeague !== 'undefined' && ccLeague.code()) || LEAGUE;
            var res = await fetch('/playoffs/bracket/' + SEASON + '/' + activeLeague);
            if (!res.ok) throw new Error('refresh failed');
            var data = await res.json();

            // The bracket is a fixed-height grid of matchups, so a repaint moves
            // nothing — but put the scroll position back anyway, since the
            // franchise table underneath it does grow as games settle.
            var y = window.scrollY;
            render(data);
            window.scrollTo(0, y);

            cfpSchedule(data);
        } catch (e) {
            // A missed tick is a stale clock, not a broken bracket.
            console.error('Bracket refresh failed:', e);
            cfpTimer = setTimeout(cfpRefresh, CFP_LIVE_MS);
        }
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { clearTimeout(cfpTimer); return; }
        if (cfpAnyLive(cfpData)) cfpRefresh();
    });

    function render(data) {
        var html = '';

        // Header
        html += '<div class="cfp-header">';
        html += '<h1 class="cfp-title">College Football Playoff</h1>';
        html += '<div class="cfp-subtitle">' + data.season + ' Season';
        if (data.projected) {
            html += ' <span class="cfp-projected-badge">' +
                    '<i class="fas fa-chart-line"></i> Projected from ' + escapeHtml(data.pollSource || 'Rankings') +
                    (data.pollWeek ? ' (Week ' + data.pollWeek + ')' : '') +
                    '</span>';
        }
        html += '</div>';
        html += '</div>';

        // Sort games by round/order
        var roundOrder = { first_round: 0, quarterfinal: 1, semifinal: 2, championship: 3 };
        var games = (data.games || []).slice().sort(function (a, b) {
            var rd = (roundOrder[a.round] || 0) - (roundOrder[b.round] || 0);
            return rd !== 0 ? rd : ((a.roundOrder || 0) - (b.roundOrder || 0));
        });

        var firstRound = games.filter(function (g) { return g.round === 'first_round'; });
        var quarterfinals = games.filter(function (g) { return g.round === 'quarterfinal'; });
        var semifinals = games.filter(function (g) { return g.round === 'semifinal'; });
        var championship = games.filter(function (g) { return g.round === 'championship'; });

        // Bracket visualization — linear left-to-right: FR → QF → SF → Championship
        html += '<div class="cfp-bracket-wrap">';
        html += '<div class="cfp-bracket-grid">';

        // Col 1: First Round (4 games)
        html += '<div class="cfp-round-col cfp-gc-1">';
        html += '<div class="cfp-round-label">' + roundLabel('first_round') + '</div>';
        firstRound.forEach(function (g) { html += matchupCard(g, data); });
        html += '</div>';

        // Col 2: Quarterfinals (4 games)
        html += '<div class="cfp-round-col cfp-gc-2">';
        html += '<div class="cfp-round-label">' + roundLabel('quarterfinal') + '</div>';
        quarterfinals.forEach(function (g) { html += matchupCard(g, data); });
        html += '</div>';

        // Col 3: Semifinals (2 games) with CFP logo between
        html += '<div class="cfp-round-col cfp-gc-3">';
        html += '<div class="cfp-round-label">' + roundLabel('semifinal') + '</div>';
        if (semifinals[0]) html += matchupCard(semifinals[0], data);
        html += '<div class="cfp-logo-divider"><img src="/images/cfp.svg" alt="College Football Playoff" class="cfp-logo-img"></div>';
        if (semifinals[1]) html += matchupCard(semifinals[1], data);
        html += '</div>';

        // Col 4: Championship + champion display
        html += '<div class="cfp-round-col cfp-gc-4">';
        html += '<div class="cfp-round-label">' + roundLabel('championship') + '</div>';
        championship.forEach(function (g) { html += matchupCard(g, data); });
        if (data.champion) {
            var champTeam = (data.participants || []).find(function (p) { return p.teamId === data.champion.teamId; });
            if (champTeam) {
                var champColor = colorHex(champTeam.color) || 'var(--cc-amber)';
                html += '<div class="cfp-champion" style="--champ-color:' + champColor + '">';
                html += '<div class="cfp-champion-crown"><i class="fas fa-crown"></i></div>';
                html += '<img src="' + logo(champTeam.logos) + '" class="cfp-champion-logo">';
                html += '<div class="cfp-champion-name">' + escapeHtml(champTeam.school) + '</div>';
                html += '<div class="cfp-champion-label">National Champions</div>';
                html += '</div>';
            }
        }
        html += '</div>';

        html += '</div>'; // bracket-grid
        html += '</div>'; // bracket-wrap

        // Mobile: linear flow (hidden on desktop)
        html += '<div class="cfp-bracket-linear">';
        [firstRound, quarterfinals, semifinals, championship].forEach(function (roundGames) {
            if (!roundGames.length) return;
            html += '<div class="cfp-round-section">';
            html += '<div class="cfp-round-label">' + roundLabel(roundGames[0].round) + '</div>';
            roundGames.forEach(function (g) {
                html += matchupCard(g, data);
            });
            html += '</div>';
        });
        html += '</div>';

        // Franchise stakes section
        if (data.franchiseSummary && data.franchiseSummary.length) {
            html += '<div class="cfp-stakes-section">';
            html += '<h2 class="cfp-stakes-title"><i class="fas fa-trophy"></i> Playoff Stakes</h2>';
            html += '<p class="cfp-stakes-subtitle">Maximum potential points if teams run the table</p>';

            var currentUserId = (typeof userState !== 'undefined' && userState && userState.user_metadata && userState.user_metadata.metadata) ? (userState.user_metadata.metadata.userId || '') : '';
            var myFranchise = data.franchiseSummary.find(function (f) { return f.userId === currentUserId; });
            var otherFranchises = data.franchiseSummary.filter(function (f) { return f.userId !== currentUserId; });

            // Desktop: all cards in one grid (always visible)
            html += '<div class="cfp-franchise-grid cfp-stakes-desktop">';
            data.franchiseSummary.forEach(function (f) { html += franchiseCard(f, data); });
            html += '</div>';

            // Mobile: user's card first, rest behind toggle
            if (myFranchise) {
                html += '<div class="cfp-stakes-mobile">';
                html += '<div class="cfp-franchise-grid">';
                html += franchiseCard(myFranchise, data);
                html += '</div>';
                html += '<div class="cfp-stakes-toggle-wrap">';
                html += '<button class="cfp-stakes-toggle" onclick="(function(btn){var sec=btn.closest(\'.cfp-stakes-mobile\').querySelector(\'.cfp-other-stakes\');var open=sec.classList.toggle(\'cfp-expanded\');btn.querySelector(\'.cfp-toggle-label\').textContent=open?\'Hide rest of league\':\'View rest of league\';btn.querySelector(\'i\').className=open?\'fas fa-chevron-up\':\'fas fa-chevron-down\';})(this)">' +
                    '<span class="cfp-toggle-label">View rest of league</span> <i class="fas fa-chevron-down"></i></button>';
                html += '</div>';
                html += '<div class="cfp-franchise-grid cfp-other-stakes">';
                otherFranchises.forEach(function (f) { html += franchiseCard(f, data); });
                html += '</div>';
                html += '</div>';
            } else {
                html += '<div class="cfp-stakes-mobile">';
                html += '<div class="cfp-franchise-grid">';
                data.franchiseSummary.forEach(function (f) { html += franchiseCard(f, data); });
                html += '</div>';
                html += '</div>';
            }

            // Undrafted teams callout
            var undrafted = (data.participants || []).filter(function (p) { return !p.owner; });
            if (undrafted.length) {
                html += '<div class="cfp-undrafted">';
                html += '<div class="cfp-undrafted-label">Undrafted Teams in the Playoff</div>';
                html += '<div class="cfp-undrafted-teams">';
                undrafted.forEach(function (p) {
                    html += '<a href="/team?team=' + p.teamId + '" class="cfp-undrafted-team">' +
                            '<img src="' + logo(p.logos) + '" class="cfp-undrafted-logo" onerror="this.style.display=\'none\'">' +
                            '<span>#' + p.seed + ' ' + escapeHtml(p.school) + '</span></a>';
                });
                html += '</div></div>';
            }

            html += '</div>';
        }

        // Points breakdown table
        html += '<div class="cfp-points-section">';
        html += '<h2 class="cfp-points-title"><i class="fas fa-calculator"></i> Points by Round</h2>';
        html += '<div class="cfp-points-table-wrap">';
        html += '<table class="cfp-points-table">';
        html += '<thead><tr><th>Round</th><th>Points</th></tr></thead><tbody>';

        var roundKeys = ['first_round', 'quarterfinal', 'semifinal', 'championship'];
        var roundNames = { first_round: 'First Round', quarterfinal: 'Quarterfinal', semifinal: 'Semifinal', championship: 'Championship' };
        roundKeys.forEach(function (rk) {
            var pts = data.pointsByRound[rk];
            if (pts == null && rk === 'first_round' && data.pointsByRound.first_round_loss != null) {
                // Claunts model: show first-round exit value
                html += '<tr><td>First Round (exit)</td><td class="cfp-pts-val">' + data.pointsByRound.first_round_loss + '</td></tr>';
                return;
            }
            if (pts != null) {
                var extra = '';
                if (rk === 'quarterfinal' && data.pointsByRound.quarterfinalByeBonus) {
                    extra = ' <span class="cfp-bye-bonus-note">(+' + data.pointsByRound.quarterfinalByeBonus + ' bye bonus for top-4 seeds)</span>';
                }
                html += '<tr><td>' + roundNames[rk] + '</td><td class="cfp-pts-val">' + pts + extra + '</td></tr>';
            }
        });
        html += '</tbody></table></div></div>';

        // Seeding field table
        html += '<div class="cfp-field-section">';
        html += '<h2 class="cfp-field-title"><i class="fas fa-list-ol"></i> The Field</h2>';
        html += '<div class="cfp-field-table-wrap">';
        html += '<table class="cfp-field-table">';
        html += '<thead><tr><th></th><th>Seed</th><th>Rank</th><th>Team</th><th>Conference</th><th>Bid</th><th>Franchise</th><th>Max Pts</th></tr></thead><tbody>';

        (data.participants || []).sort(function (a, b) { return a.seed - b.seed; }).forEach(function (p) {
            var teamColor = colorHex(p.color) || 'var(--cc-muted-2)';
            var byeBadge = p.firstRoundBye ? ' <span class="cfp-bye-tag">BYE</span>' : '';
            var ownerName = p.owner ? '<a href="/userHome?user=' + p.owner.userId + '" class="cfp-field-owner" style="color:' + (colorHex(p.owner.color) || 'var(--cc-interactive)') + '">' + escapeHtml(p.owner.franchise) + '</a>' : '<span class="cfp-undrafted-tag">—</span>';
            var bidLabel = p.bidType === 'auto' ? '<span class="cfp-auto-bid">Auto</span>' : '<span class="cfp-at-large">At-Large</span>';

            html += '<tr class="cfp-field-row">';
            html += '<td><a href="/team?team=' + p.teamId + '"><img src="' + logo(p.logos) + '" class="cfp-field-logo" onerror="this.style.display=\'none\'"></a></td>';
            html += '<td class="cfp-field-seed">' + p.seed + byeBadge + '</td>';
            var rankDisplay = (p.rank && p.rank <= 25) ? '#' + p.rank : '<span class="cfp-unranked">NR</span>';
            html += '<td class="cfp-field-rank">' + rankDisplay + '</td>';
            html += '<td><a href="/team?team=' + p.teamId + '" class="cfp-field-school">' + escapeHtml(p.school) + '</a></td>';
            html += '<td class="cfp-field-conf">' + escapeHtml(p.conference) + '</td>';
            html += '<td>' + bidLabel + '</td>';
            html += '<td>' + ownerName + '</td>';
            html += '<td class="cfp-field-maxpts">' + (p.maxPoints || 0) + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table></div></div>';

        container.innerHTML = html;
    }

    load();

    var _lSel = document.querySelector('[league-select]');
    if (_lSel) {
        _lSel.addEventListener('change', function () {
            var opt = this.options[this.selectedIndex];
            try { window.localStorage.setItem('leagueCode', opt.value); } catch (e) {}
            window.location.reload();
        });
    }
})();
