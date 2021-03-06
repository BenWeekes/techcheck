// create Agora client
var client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
const PROTOCOL_FAIL=-1;
const PROTOCOL_UDP=1;
const PROTOCOL_TCP=2;

var localTracks = {
    videoTrack: null,
    audioTrack: null,
    audioSourceTrack: null
};
var remoteUsers = {};
// Agora client optionsi
var options = {
    appid: null,
    channel: null,
    uid: null,
    token: null
};

var mics = []; // all microphones devices you can use
var cams = []; // all cameras devices you can use
var speakers = []; // all speaker devices you can use
var currentMic; // the microphone you are using
var currentCam; // the camera you are using

let volumeAnimation;

// the demo can auto join channel with params in url
$(async () => {
    //$("#media-device-test").modal("show");

    $(".cam-list").delegate("a", "click", function (e) {
        switchCamera(this.text);
    });
    $(".mic-list").delegate("a", "click", function (e) {
        switchMicrophone(this.text);
    });
    $(".speaker-list").delegate("a", "click", function (e) {
        switchSpeaker(this.text, $(this).data('deviceid'));
    });

    var urlParams = new URL(location.href).searchParams;
    options.appid = urlParams.get("appid");
    options.channel = urlParams.get("channel");
    options.token = urlParams.get("token");
    options.uid = urlParams.get("uid");
    
})

$("#join-form").submit(async function (e) {
    e.preventDefault();
    $("#join").attr("disabled", true);
    $("#device-wrapper").css("display", "flex");
    try {
        options.appid = $("#appid").val();  
        options.token = $("#token").val();
        options.channel = $("#channel").val();
        options.uid = Number($("#uid").val());
        await join();
        if (options.token) {
            $("#success-alert-with-token").css("display", "block");
        } else {
            $("#success-alert a").attr("href", `index.html?appid=${options.appid}&channel=${options.channel}&token=${options.token}&uid=${options.uid}`);
            $("#success-alert").css("display", "block");
        }
    } catch (error) {
        console.error(error);
    } finally {
        $("#leave").attr("disabled", false);
    }
})

$("#leave").click(function (e) {
    leave();
})


async function check_publish(proxy_type) {

    var isTCP = false;
    await client.publish([localTracks.audioTrack, localTracks.videoTrack]).then(response => {
        if (client._highStream && client._highStream.pc) {
            if (client._highStream.pc && client._highStream.pc.pc) {
                client._highStream.pc.pc.getStats(null).then(stats => {
                    stats.forEach(report => {
                        if (report.type === "local-candidate") {
                            if (report["relayProtocol"] === "tcp" && report["candidateType"] === "relay") {
                                isTCP = true;
                            }
                        }
                    })
                }).then(value => {
                    if (isTCP) {
                        $("#connection_container_inner").append(" Join success (" + proxy_type + ") protocol = TCP ");
                        return PROTOCOL_TCP;
                    } else {
                        $("#connection_container_inner").append(" Join success (" + proxy_type + ") protocol = UDP ");
                        return PROTOCOL_UDP;
                    }
                });
            }
        }
    }).catch(e => {
        $("#connection_container_inner").html("Join success (" + proxy_type + ") but publish failed");
        return "fail";
    });
}

async function check_join(appid, channel, token, proxy_mode, timeout) {
    if (proxy_mode > 0) {
        client.startProxyServer(proxy_mode);
    }
   await Promise.all([
        Promise.race(
            [client.join(appid, channel, token || null), // if succeeds (calls resolve() internally) it will callback to the then block 
            new Promise((resolve, reject) => {
                setTimeout(() => {
                    reject(); // calls back to the catch block below
                },timeout);                  
            })]).then((msg) => { // join success
                 return check_publish("Proxy " + proxy_mode);
 
            }
            ).catch((msg) => {
                return PROTOCOL_FAIL;
            }
            )
    ]);
    return PROTOCOL_FAIL;
}

$("#tech_check").click(async function (e) {

    console.log("tech check");
    var $myForm = $('#join-form');
    if (!$myForm[0].checkValidity()) {
        return;
    }

    var appid = $("#appid").val();
    var channel = "techcheck";
    var token = $("#token").val();
    $("#connection_container_inner").html("Starting Connect");
    await mediaDeviceTest();
    volumeAnimation = requestAnimationFrame(setVolumeWave);

    // try with proxy mode 4 and wait for 10 seconds to fail
    var join = check_join( appid, channel, token, 4, 10000);

    // if join is via TCP you could consider another join via Cloud Proxy and switch to that if successful
    // or auto try via cloud proxy

    console.log(join);

    $("#mic_container").removeClass("hidden");
    $("#cam_container").addClass("hidden");
    $("#speaker_container").addClass("hidden");
    $("#connection_container").addClass("hidden");

    $("#media-device-test").modal("show");
});

$("#mic_complete").click(function (e) {
    $("#mic_container").addClass("hidden");
    $("#cam_container").removeClass("hidden");
});

$("#cam_complete").click(function (e) {
    $("#cam_container").addClass("hidden");
    $("#speaker_container").removeClass("hidden");
});

$("#speaker_complete").click(function (e) {
    $("#speaker_container").addClass("hidden");
    $("#connection_container").removeClass("hidden");
});


$("#media-device-test").on("hidden.bs.modal", function (e) {
    cancelAnimationFrame(volumeAnimation);
    leave();
})

async function join() {
    // add event listener to play remote tracks when remote user publishs.
    client.on("user-published", handleUserPublished);
    client.on("user-unpublished", handleUserUnpublished);
    client.on('user-left', handleUserLeft);

    // join a channel.
    options.uid = await client.join(options.appid, options.channel, options.token || null);

    if (!localTracks.audioTrack || !localTracks.videoTrack) {
        [localTracks.audioTrack, localTracks.videoTrack] = await Promise.all([
            // create local tracks, using microphone and camera
            AgoraRTC.createMicrophoneAudioTrack({ microphoneId: currentMic.deviceId }),
            AgoraRTC.createCameraVideoTrack({ cameraId: currentCam.deviceId })
        ]);
    }

    // play local video track
    localTracks.videoTrack.play("local-player");
    $("#local-player-name").text(`localVideo(${options.uid})`);

    // publish local tracks to channel
    await client.publish(Object.values(localTracks));
    console.log("publish success");
}

async function mediaDeviceTest() {
    // create local tracks
    [localTracks.audioTrack, localTracks.videoTrack, localTracks.audioSourceTrack] = await Promise.all([
        // create local tracks, using microphone and camera
        AgoraRTC.createMicrophoneAudioTrack(),
        AgoraRTC.createCameraVideoTrack(),
        AgoraRTC.createBufferSourceAudioTrack({
            source: "./music.mp3",
        })
    ]);

    // play local track on device detect dialog
    localTracks.videoTrack.play("pre-local-player");
    // localTracks.audioTrack.play();

    // get mics
    mics = await AgoraRTC.getMicrophones();
    currentMic = mics[0];
    $(".mic-input").val(currentMic.label);
    mics.forEach(mic => {
        $(".mic-list").append(`<a class="dropdown-item" href="#">${mic.label}</a>`);
    });

    // get cameras
    cams = await AgoraRTC.getCameras();
    currentCam = cams[0];
    $(".cam-input").val(currentCam.label);
    cams.forEach(cam => {
        $(".cam-list").append(`<a class="dropdown-item" href="#">${cam.label}</a>`);
    });

    //get speakers
    speakers = await AgoraRTC.getPlaybackDevices();
    $(".speaker-input").val(speakers[0].label);
    speakers.forEach(speaker => {
        $(".speaker-list").append(`<a class="dropdown-item" data-deviceid="${speaker.deviceId}">${speaker.label}</a>`);
    });
    $('.speaker-play').click(() => {
        localTracks.audioSourceTrack.startProcessAudioBuffer();
        localTracks.audioSourceTrack.play();
    });

}


async function leave() {
    for (trackName in localTracks) {
        var track = localTracks[trackName];
        if (track) {
            track.stop();
            track.close();
            localTracks[trackName] = undefined;
        }
    }

    localTracks = {};

    // remove remote users and player views
    remoteUsers = {};
    $("#remote-playerlist").html("");

    // leave the channel
    await client.leave();

    $("#local-player-name").text("");
    $("#join").attr("disabled", false);
    $("#leave").attr("disabled", true);
    $("#device-wrapper").css("display", "none");
    console.log("client leaves channel success");
}

async function handleUserPublished(user, mediaType) {
    const uid = user.uid;

    if (!remoteUsers[uid]) {
        remoteUsers[uid] = user;
        const player = $(`
      <div id="player-wrapper-${uid}">
        <p class="player-name">remoteUser(${uid})</p>
        <div id="player-${uid}" class="player"></div>
      </div>
    `);
        $("#remote-playerlist").append(player);
    }

    await client.subscribe(user, mediaType);

    if (mediaType === 'video') {
        user.videoTrack.play(`player-${uid}`);
    }
    if (mediaType === 'audio') {
        const speakerElement = $(`
      <div class="input-group remote-audio-devices-${uid}">
        <div class="input-group-prepend">
          <button class="btn btn-outline-secondary dropdown-toggle" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">Speakers</button>
          <div class="speaker-list dropdown-menu"></div>
        </div>
        <input type="text" class="speaker-input form-control" aria-label="Text input with dropdown button" readonly>
      </div>
    `);

        $(`#player-wrapper-${uid} .player-name`).after(speakerElement);

        speakers.forEach(speaker => {
            $(`.remote-audio-devices-${uid} .speaker-list`).append(`<a class="dropdown-item" data-deviceid="${speaker.deviceId}">${speaker.label}</a>`);
        });

        $(`#player-wrapper-${uid} .speaker-input`).val(speakers[0].label);

        $(`.remote-audio-devices-${uid} .speaker-list`).delegate('a', 'click', function () {
            user.audioTrack.setPlaybackDevice($(this).data('deviceid'));
            $(`#player-wrapper-${uid} .speaker-input`).val($(this).text());
        });

        user.audioTrack.play();
    }
}

function handleUserUnpublished(user) {
    // const id = user.uid;
    // delete remoteUsers[id];
    // $(`#player-wrapper-${id}`).remove();
}

function handleUserLeft(user) {
    const id = user.uid;
    delete remoteUsers[id];
    const player = $(`#player-wrapper-${id}`);
    if (player) {
        player.remove();
    }
}

async function switchCamera(label) {
    currentCam = cams.find(cam => cam.label === label);
    $(".cam-input").val(currentCam.label);
    // switch device of local video track.
    await localTracks.videoTrack.setDevice(currentCam.deviceId);
}

async function switchMicrophone(label) {
    currentMic = mics.find(mic => mic.label === label);
    $(".mic-input").val(currentMic.label);
    // switch device of local audio track.
    await localTracks.audioTrack.setDevice(currentMic.deviceId);
}

async function switchSpeaker(label, deviceId) {
    $(".speaker-input").val(label);
    // switch device of local audio track.
    await localTracks.audioSourceTrack.setPlaybackDevice(deviceId);
}

// show real-time volume while adjusting device.
function setVolumeWave() {
    volumeAnimation = requestAnimationFrame(setVolumeWave);
    $(".progress-bar").css("width", localTracks.audioTrack.getVolumeLevel() * 100 + "%")
    $(".progress-bar").attr("aria-valuenow", localTracks.audioTrack.getVolumeLevel() * 100)
}

