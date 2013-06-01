/*jshint browser: true*/
/*global browserid_common: true, jQuery: true*/
(function() {
  "use strict";

  // what login type is being handled?
  var loginType;

  // When onlogin is invoked and there is no login state, should submit be forced?
  var forceSubmit;

  // Keep track of whether the onlogout callback should be ignored. Ignoring
  // the onlogout callback prevents the user from being redirected to the
  // logout page.
  var ignoreLogout = false;


  jQuery(".persona_login").click(function(event) {
    event.preventDefault();

    ignoreLogout = false;
    requestAuthentication("login");
  });

  jQuery(".persona_register").click(function(event) {
    event.preventDefault();

    ignoreLogout = false;
    // Save the form state to localStorage. This allows a new user to close
    // this tab while they are verifying and still have the registration
    // complete once the address is verified.
    saveRegistrationState();
    requestAuthentication("register");
  });

  jQuery(".persona_submit_comment").click(function(event) {
    event.preventDefault();

    ignoreLogout = true;
    // Save the form state to localStorage. This allows a new user to close
    // this tab while they are verifying and still have the comment form
    // submitted once the address is verified.
    saveCommentState();
    requestAuthentication("comment");
  });

  jQuery(".persona_logout").click(function(event) {
    event.preventDefault();

    ignoreLogout = false;
    navigator.id.logout();
  });

  if (document.location.hash === "#submit_comment") {
    // During comment submission, ignore the logout messages until
    // the user explicitly requests a login.
    ignoreLogout = true;

    showWaitingScreen();

    // load the state into the form to reduce flicker. The form data may not be
    // needed, but load it anyways.
    var state = loadCommentState();

    // If there is no state, the other window has already submitted the comment.
    // navigator.id.logout has already been called and no assertion will be
    // generated. wait for the signal from the other window and refresh the page
    // to view the newly inserted comment.
    if (!state) return refreshWhenCommentSubmitComplete();

    // If the comment form is submitted in the original window, the user will
    // be sitting at the top of the page. Instead, go to the submit form.
    document.location.hash = "respond";

    loginType = "comment";

    // If this is the post Persona verification page AND we got the state
    // before the other page, forceSubmit. loadCommentState removes the
    // comment state from localStorage which normally causes onlogin to
    // abort all action.
    forceSubmit = true;
  }
  else if (document.location.hash === "#submit_registration") {
    ignoreLogout = true;

    showWaitingScreen();

    // load the state into the form to reduce flicker. The form data may not be
    // needed, but load it anyways.
    var state = loadRegistrationState();

    // If there is no state, the other window has already submitted the registration.
    // Wait for the signal from the other window which causes a refresh. When
    // the signal comes, refresh to the profile page.
    if (!state) return refreshWhenRegistrationSubmitComplete();

    loginType = "register";

    // If this is the post Persona verification page AND we got the state
    // before the other page, forceSubmit. loadRegistrationState removes the
    // comment state from localStorage which normally causes onlogin to
    // abort all action.
    forceSubmit = true;
  }
  else if ((document.location.href === browserid_common.registration_redirect) &&
           (sessionStorage.getItem("submitting_registration"))) {
    // If the user lands on the registration_redirect page AND they just came
    // from the Registration page, inform other pages that registration has
    // completed so they can redirect.
    localStorage.setItem("registration_complete", "true");
  }
  else if (sessionStorage.getItem("submitting_comment")) {
    ignoreLogout = true;

    // If the user just completed comment submission, save the hash to
    // localStorage so the other window can refresh to the new comment.
    // We are just assuming the comment submission was successful.
    sessionStorage.removeItem("submitting_comment");
    localStorage.setItem("comment_hash", document.location.hash);
  }



  // If there was an error, log the user out.
  if (browserid_common.error || jQuery("#login_error").length) {
    ignoreLogout = true;

    navigator.id.logout();
  }



  var loginHandlers = {
    login: submitLoginForm,
    register: submitRegistrationForm,
    comment: submitCommentForm
  };

  navigator.id.watch({
    loggedInUser: browserid_common.logged_in_user || null,
    onlogin: function(assertion) {
      loginType = getLoginType(loginType);

      var handler = loginHandlers[loginType];
      if (handler) {
        handler(assertion);
      }
    },
    onlogout: function() {
      // The logout was either due to an error which must be shown or to
      // the user leaving a comment but not being logged in. Either way,
      // do not redirect the user, they are where they want to be.
      if (ignoreLogout) return;

      // There is a bug in Persona with Chrome. When a user signs in, the
      // onlogout callback is first fired. Check if a user is actually
      // signed in before redirecting to the logout URL.
      if (browserid_common.logged_in_user) {
        document.location = browserid_common.logout_redirect;
      }
    }
  });

  function getLoginType(loginType) {
    return loginType || "login";
  }


  function requestAuthentication(type) {
    loginType = type;

    var opts = {
      siteName: browserid_common.sitename || "",
      siteLogo: browserid_common.sitelogo || ""
    };

   /**
    * If the user is signing in to comment or signing up as a new member
    * and must verify, redirect with a special hash. The form will be
    * submitted by the first page to receive an onlogin.
    *
    * This behavior is necessary because we are unsure whether the user
    * will complete verification in the original window or in a new window.
    */
    if (loginType === "comment") {
      opts.returnTo = getReturnToUrl("#submit_comment");
    }
    else if (loginType === "register") {
      opts.returnTo = getReturnToUrl("#submit_registration");
    }

    navigator.id.request(opts);
  }






  /**
   * LOGIN CODE
   */
  function submitLoginForm(assertion) {
    var rememberme = document.getElementById("rememberme");
    if (rememberme !== null)
      rememberme = rememberme.checked;

    // Since login can happen on any page, create a form
    // and submit it manually ignoring the normal sign in form.
    var form = document.createElement("form");
    form.setAttribute("style", "display: none;");
    form.method = "POST";
    form.action = browserid_common.siteurl;

    var fields = {
      browserid_assertion: assertion,
      rememberme: rememberme
    };

    if (browserid_common.login_redirect !== null)
      fields.redirect_to = browserid_common.login_redirect;

    appendFormHiddenFields(form, fields);

    jQuery("body").append(form);
    form.submit();
  }







  /**
   * COMMENT CODE
   */

  function submitCommentForm(assertion) {
    // If this is a new user that is verifying their email address in a new
    // window, both the original window and this window will be trying to
    // submit the comment form. The first one wins. The other one reloads.
    var state = loadCommentState();
    if (!(state || forceSubmit)) return refreshWhenCommentSubmitComplete();

    var form = jQuery("#commentform");

    // Get the post_id from the dom because the postID could in theory
    // change from the original if the submission is happening in a
    // new tab after email verification.
    var post_id = jQuery("#comment_post_ID").val();

    appendFormHiddenFields(form, {
      browserid_comment: post_id,
      browserid_assertion: assertion
    });

    // Save the hash so the other window can redirect to the proper comment
    // when everything has completed.
    localStorage.removeItem("comment_hash");
    sessionStorage.setItem("submitting_comment", "true");

    // If the user is submitting a comment and is not logged in,
    // log them out of Persona. This will prevent the plugin from
    // trying to log the user in to the site once the comment is posted.
    if (!browserid_common.logged_in_user) {
      ignoreLogout = true;
      navigator.id.logout();
    }

    jQuery("#submit").click();
  }

  function saveCommentState() {
    var state = {
      author: jQuery("#author").val(),
      url: jQuery("#url").val(),
      comment: jQuery("#comment").val(),
      comment_parent: jQuery("#comment_parent").val()
    };

    localStorage.setItem("comment_state", JSON.stringify(state));
  }

  function loadCommentState() {
    var state = localStorage.getItem("comment_state");

    if (state) {
      state = JSON.parse(state);
      jQuery("#author").val(state.author);
      jQuery("#url").val(state.url);
      jQuery("#comment").val(state.comment);
      jQuery("#comment_parent").val(state.comment_parent);
      localStorage.removeItem("comment_state");
    }

    return state;
  }

  function refreshWhenCommentSubmitComplete() {
    // wait until the other window has completed the comment submit. When it
    // completes, it will store the hash of the comment that this window should
    // show.
    var hash = localStorage.getItem("comment_hash");
    if (hash) {
      localStorage.removeItem("comment_hash");
      document.location.hash = hash;
      document.location.reload(true);
    }
    else {
      setTimeout(refreshWhenCommentSubmitComplete, 100);
    }
  }






  /**
   * REGISTRATION CODE
   */

  function submitRegistrationForm(assertion) {
    // If this is a new user that is verifying their email address in a new
    // window, both the original window and this window will be trying to
    // submit the comment form. The first one wins. The other one reloads.
    var state = loadRegistrationState();
    if (!(state || forceSubmit)) return refreshWhenRegistrationSubmitComplete();

    // Save an item on sessionStorage that says we are completing registration.
    // When the page lands on the registration_complete redirect, it will check
    // sessionStorage, and if submitting_registration is set, it will notify
    // any other windows that registration has completed by setting a bit in
    // localStorage.
    sessionStorage.setItem("submitting_registration", "true");
    jQuery("#browserid_assertion").val(assertion);
    jQuery("#wp-submit").click();
  }

  function saveRegistrationState() {
    var state = {
      user_login: jQuery("#user_login").val()
    };

    localStorage.setItem("registration_state", JSON.stringify(state));
  }

  function loadRegistrationState() {
    var state = localStorage.getItem("registration_state");

    if (state) {
      state = JSON.parse(state);
      jQuery("#user_login").val(state.user_login);
      localStorage.removeItem("registration_state");
    }

    return state;
  }

  function refreshWhenRegistrationSubmitComplete() {
    // wait until the other window has completed the registration submit. When it
    // completes, it will store a bit in localStorage when registration has
    // completed.
    var complete = localStorage.getItem("registration_complete");
    if (complete) {
      localStorage.removeItem("registration_complete");
      document.location = browserid_common.registration_redirect;
    }
    else {
      setTimeout(refreshWhenRegistrationSubmitComplete, 100);
    }
  }





  /**
   * HELPER CODE
   */
  function getReturnToUrl(hash) {
    return document.location.href
               .replace(/http(s)?:\/\//, "")
               .replace(document.location.host, "")
               .replace(/#.*$/, '') + hash;
  }

  function appendFormHiddenFields(form, fields) {
    form = jQuery(form);

    for (var name in fields) {
      var field = document.createElement("input");
      field.type = "hidden";
      field.name = name;
      field.value = fields[name];
      form.append(field);
    }
  }

  function showWaitingScreen() {
    var waitingScreen = jQuery("<div class='persona_submit'></div>");
    jQuery("body").append(waitingScreen);
  }


}());
